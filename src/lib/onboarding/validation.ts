/**
 * Integration name validation for the onboarding flow.
 *
 * Validates that integration names meet the required format:
 * 1-100 characters, containing only letters, numbers, hyphens, and underscores.
 *
 * Requirements: 2.2, 2.6
 */

/** Pattern matching valid integration name characters */
const VALID_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Maximum allowed length for an integration name */
const MAX_NAME_LENGTH = 100;

/**
 * Result of an integration name validation check.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates an integration name against the allowed format.
 *
 * Accepted names must be between 1 and 100 characters (inclusive) and contain
 * only alphanumeric characters, hyphens, and underscores (`[a-zA-Z0-9_-]`).
 *
 * @param name - The integration name to validate
 * @returns A ValidationResult indicating whether the name is valid, with an error message if not
 */
export function validateIntegrationName(name: string): ValidationResult {
  if (!name || name.length === 0) {
    return { valid: false, error: "Integration name is required" };
  }

  if (name.length > MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: "Integration name must be 100 characters or fewer",
    };
  }

  if (!VALID_NAME_PATTERN.test(name)) {
    return {
      valid: false,
      error:
        "Integration name can only contain letters, numbers, hyphens, and underscores",
    };
  }

  return { valid: true };
}
