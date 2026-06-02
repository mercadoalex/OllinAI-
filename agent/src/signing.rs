//! Ed25519 attestation signing and verification.
//!
//! Uses the `ring` crate for Ed25519 key pair management.
//! Each agent holds a unique Ed25519 private key for signing Build_Attestations.
//! Ed25519 provides fast signing/verification, small signatures (64 bytes),
//! and resistance to implementation errors compared to ECDSA.
//!
//! Requirements: 13.7

use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair, UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Errors that can occur during signing operations.
#[derive(Debug, thiserror::Error)]
pub enum SigningError {
    #[error("Failed to generate key pair: {0}")]
    KeyGeneration(String),

    #[error("Failed to load key from file: {0}")]
    KeyLoad(String),

    #[error("Failed to parse key pair from PKCS8: {0}")]
    KeyParse(String),

    #[error("Failed to sign data: {0}")]
    SignFailure(String),

    #[error("Signature verification failed")]
    VerificationFailed,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// A signed Build_Attestation ready for transmission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedAttestation {
    /// The attestation document serialized as JSON
    pub attestation_json: String,

    /// Ed25519 signature over the attestation JSON, base64-encoded
    pub signature: String,

    /// Public key for verification, base64-encoded
    pub public_key: String,
}

/// Manages Ed25519 key pair for attestation signing.
pub struct AttestationSigner {
    /// The Ed25519 key pair
    key_pair: Ed25519KeyPair,

    /// PKCS8 document bytes (for persistence)
    pkcs8_bytes: Vec<u8>,
}

impl AttestationSigner {
    /// Generate a new random Ed25519 key pair.
    pub fn generate() -> Result<Self, SigningError> {
        let rng = SystemRandom::new();
        let pkcs8_bytes = Ed25519KeyPair::generate_pkcs8(&rng)
            .map_err(|e| SigningError::KeyGeneration(e.to_string()))?;

        let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8_bytes.as_ref())
            .map_err(|e| SigningError::KeyParse(e.to_string()))?;

        Ok(Self {
            key_pair,
            pkcs8_bytes: pkcs8_bytes.as_ref().to_vec(),
        })
    }

    /// Load an Ed25519 key pair from a PKCS8 DER file.
    pub fn from_file(path: &Path) -> Result<Self, SigningError> {
        let pkcs8_bytes = std::fs::read(path)
            .map_err(|e| SigningError::KeyLoad(format!("{}: {}", path.display(), e)))?;

        let key_pair = Ed25519KeyPair::from_pkcs8(&pkcs8_bytes)
            .map_err(|e| SigningError::KeyParse(e.to_string()))?;

        Ok(Self {
            key_pair,
            pkcs8_bytes,
        })
    }

    /// Load an Ed25519 key pair from raw PKCS8 bytes.
    pub fn from_pkcs8(pkcs8_bytes: &[u8]) -> Result<Self, SigningError> {
        let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8_bytes)
            .map_err(|e| SigningError::KeyParse(e.to_string()))?;

        Ok(Self {
            key_pair,
            pkcs8_bytes: pkcs8_bytes.to_vec(),
        })
    }

    /// Save the PKCS8 key to a file.
    pub fn save_to_file(&self, path: &Path) -> Result<(), SigningError> {
        std::fs::write(path, &self.pkcs8_bytes)?;
        Ok(())
    }

    /// Get the public key bytes.
    pub fn public_key_bytes(&self) -> &[u8] {
        self.key_pair.public_key().as_ref()
    }

    /// Get the public key as base64-encoded string.
    pub fn public_key_base64(&self) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(self.public_key_bytes())
    }

    /// Sign data with the Ed25519 private key.
    ///
    /// Returns the signature as raw bytes (64 bytes).
    pub fn sign(&self, data: &[u8]) -> Vec<u8> {
        self.key_pair.sign(data).as_ref().to_vec()
    }

    /// Sign data and return the signature as base64-encoded string.
    pub fn sign_base64(&self, data: &[u8]) -> String {
        use base64::Engine;
        let sig = self.sign(data);
        base64::engine::general_purpose::STANDARD.encode(&sig)
    }

    /// Sign a Build_Attestation document and produce a SignedAttestation.
    pub fn sign_attestation(
        &self,
        attestation: &crate::attestation::BuildAttestation,
    ) -> Result<SignedAttestation, SigningError> {
        let attestation_json = serde_json::to_string(attestation)
            .map_err(|e| SigningError::SignFailure(e.to_string()))?;

        let signature = self.sign_base64(attestation_json.as_bytes());
        let public_key = self.public_key_base64();

        Ok(SignedAttestation {
            attestation_json,
            signature,
            public_key,
        })
    }

    /// Get raw PKCS8 bytes (for testing/persistence).
    pub fn pkcs8_bytes(&self) -> &[u8] {
        &self.pkcs8_bytes
    }
}

/// Verify an Ed25519 signature over data using a public key.
///
/// - `public_key_bytes`: Raw public key (32 bytes)
/// - `data`: The signed data
/// - `signature`: The signature bytes (64 bytes)
pub fn verify_signature(
    public_key_bytes: &[u8],
    data: &[u8],
    signature: &[u8],
) -> Result<(), SigningError> {
    let public_key = UnparsedPublicKey::new(&ED25519, public_key_bytes);
    public_key
        .verify(data, signature)
        .map_err(|_| SigningError::VerificationFailed)
}

/// Verify a SignedAttestation using the embedded public key.
pub fn verify_signed_attestation(signed: &SignedAttestation) -> Result<(), SigningError> {
    use base64::Engine;

    let public_key_bytes = base64::engine::general_purpose::STANDARD
        .decode(&signed.public_key)
        .map_err(|_e| SigningError::VerificationFailed)?;

    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(&signed.signature)
        .map_err(|_e| SigningError::VerificationFailed)?;

    verify_signature(
        &public_key_bytes,
        signed.attestation_json.as_bytes(),
        &signature_bytes,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ancestry::ProcessAncestry;
    use crate::attestation::{AttestationBuilder, BuildAttestation};
    use crate::telemetry::TelemetryEvent;
    use proptest::prelude::*;
    use std::path::PathBuf;

    fn make_test_attestation() -> BuildAttestation {
        let mut builder = AttestationBuilder::new(
            "pipeline-test".to_string(),
            "tenant-test".to_string(),
            "svc-test".to_string(),
        );
        builder.process_event(&TelemetryEvent::ProcessTree {
            pid: 1,
            ppid: 0,
            comm: "bash".to_string(),
            argv: vec!["-c".to_string(), "make build".to_string()],
            cwd: PathBuf::from("/app"),
            timestamp_ns: 1000,
        });
        let ancestry = ProcessAncestry::new(1);
        builder.finalize(ancestry, "0.1.0")
    }

    #[test]
    fn test_key_generation() {
        let signer = AttestationSigner::generate().unwrap();
        assert_eq!(signer.public_key_bytes().len(), 32);
    }

    #[test]
    fn test_sign_and_verify() {
        let signer = AttestationSigner::generate().unwrap();
        let data = b"hello, attestation";

        let signature = signer.sign(data);
        assert_eq!(signature.len(), 64); // Ed25519 signatures are 64 bytes

        let result = verify_signature(signer.public_key_bytes(), data, &signature);
        assert!(result.is_ok());
    }

    #[test]
    fn test_sign_and_verify_attestation() {
        let signer = AttestationSigner::generate().unwrap();
        let attestation = make_test_attestation();

        let signed = signer.sign_attestation(&attestation).unwrap();
        assert!(!signed.attestation_json.is_empty());
        assert!(!signed.signature.is_empty());
        assert!(!signed.public_key.is_empty());

        // Verify
        let result = verify_signed_attestation(&signed);
        assert!(result.is_ok());
    }

    #[test]
    fn test_tampered_attestation_fails_verification() {
        let signer = AttestationSigner::generate().unwrap();
        let attestation = make_test_attestation();

        let mut signed = signer.sign_attestation(&attestation).unwrap();
        // Tamper with the attestation JSON
        signed.attestation_json.push_str("TAMPERED");

        let result = verify_signed_attestation(&signed);
        assert!(result.is_err());
    }

    #[test]
    fn test_wrong_key_fails_verification() {
        let signer1 = AttestationSigner::generate().unwrap();
        let signer2 = AttestationSigner::generate().unwrap();
        let data = b"some data";

        let signature = signer1.sign(data);
        // Verify with wrong public key
        let result = verify_signature(signer2.public_key_bytes(), data, &signature);
        assert!(result.is_err());
    }

    #[test]
    fn test_pkcs8_roundtrip() {
        let signer1 = AttestationSigner::generate().unwrap();
        let pkcs8 = signer1.pkcs8_bytes().to_vec();

        let signer2 = AttestationSigner::from_pkcs8(&pkcs8).unwrap();

        // Both should produce the same signature
        let data = b"test data";
        let sig1 = signer1.sign(data);
        let sig2 = signer2.sign(data);
        assert_eq!(sig1, sig2);
    }

    #[test]
    fn test_public_key_base64() {
        let signer = AttestationSigner::generate().unwrap();
        let b64 = signer.public_key_base64();
        // Base64 of 32 bytes = 44 chars (with padding)
        assert_eq!(b64.len(), 44);
    }

    // --- Property-based tests ---

    proptest! {
        /// **Validates: Requirements 13.7** - Signatures are always 64 bytes
        #[test]
        fn prop_signature_always_64_bytes(
            data_len in 1usize..1000,
        ) {
            let signer = AttestationSigner::generate().unwrap();
            let data: Vec<u8> = (0..data_len).map(|i| (i % 256) as u8).collect();
            let signature = signer.sign(&data);
            prop_assert_eq!(signature.len(), 64);
        }

        /// **Validates: Requirements 13.7** - Valid signatures always verify
        #[test]
        fn prop_valid_signature_verifies(
            data_len in 1usize..500,
        ) {
            let signer = AttestationSigner::generate().unwrap();
            let data: Vec<u8> = (0..data_len).map(|i| (i % 256) as u8).collect();

            let signature = signer.sign(&data);
            let result = verify_signature(signer.public_key_bytes(), &data, &signature);
            prop_assert!(result.is_ok());
        }

        /// **Validates: Requirements 13.7** - Tampered data fails verification
        #[test]
        fn prop_tampered_data_fails_verification(
            data_len in 2usize..500,
            tamper_pos in 0usize..499,
        ) {
            let signer = AttestationSigner::generate().unwrap();
            let data: Vec<u8> = (0..data_len).map(|i| (i % 256) as u8).collect();
            let signature = signer.sign(&data);

            // Tamper with data
            let mut tampered = data.clone();
            let pos = tamper_pos % tampered.len();
            tampered[pos] = tampered[pos].wrapping_add(1);

            let result = verify_signature(signer.public_key_bytes(), &tampered, &signature);
            prop_assert!(result.is_err());
        }

        /// **Validates: Requirements 13.7** - Different keys produce different signatures
        #[test]
        fn prop_different_keys_different_signatures(
            data_len in 1usize..200,
        ) {
            let signer1 = AttestationSigner::generate().unwrap();
            let signer2 = AttestationSigner::generate().unwrap();
            let data: Vec<u8> = (0..data_len).map(|i| (i % 256) as u8).collect();

            let sig1 = signer1.sign(&data);
            let sig2 = signer2.sign(&data);

            // Signatures from different keys should differ (with overwhelming probability)
            prop_assert_ne!(sig1, sig2);
        }
    }
}
