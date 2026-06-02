/**
 * EventBridge Rule Definitions for OllinAI Platform
 *
 * Routes events between components for decoupled processing:
 * - correlation.created -> DORA Computer Lambda + Recommendation Engine Lambda
 * - deployment.ingested -> triggers DORA recomputation
 * - incident.ingested -> triggers DORA recomputation
 *
 * These definitions can be used with AWS CDK, CloudFormation, or for local testing.
 */

export interface EventPattern {
  source: string[];
  "detail-type": string[];
  detail?: Record<string, unknown>;
}

export interface EventBridgeRuleDefinition {
  ruleName: string;
  description: string;
  eventBusName: string;
  eventPattern: EventPattern;
  targets: EventBridgeTarget[];
}

export interface EventBridgeTarget {
  id: string;
  arn: string;
  /** Input transformer for the target (optional) */
  inputPath?: string;
}

/**
 * The custom event bus name for OllinAI events.
 */
export const EVENT_BUS_NAME = "ollinai-events-bus";

/**
 * Event source identifiers used in EventBridge patterns.
 */
export const EVENT_SOURCES = {
  CORRELATOR: "ollinai.correlator",
  INGESTION: "ollinai.ingestion",
  RISK_SCORER: "ollinai.risk-scorer",
} as const;

/**
 * Event detail types for routing.
 */
export const EVENT_DETAIL_TYPES = {
  CORRELATION_CREATED: "correlation.created",
  DEPLOYMENT_INGESTED: "deployment.ingested",
  INCIDENT_INGESTED: "incident.ingested",
  RISK_SCORE_COMPUTED: "risk-score.computed",
} as const;

/**
 * EventBridge rule definitions for the OllinAI platform.
 * Lambda ARNs are placeholders — replaced at deploy time via CDK/SAM.
 */
export const eventBridgeRuleDefinitions: EventBridgeRuleDefinition[] = [
  {
    ruleName: "ollinai-correlation-to-dora",
    description:
      "Routes correlation.created events to DORA Computer for metric recomputation",
    eventBusName: EVENT_BUS_NAME,
    eventPattern: {
      source: [EVENT_SOURCES.CORRELATOR],
      "detail-type": [EVENT_DETAIL_TYPES.CORRELATION_CREATED],
    },
    targets: [
      {
        id: "dora-computer-lambda",
        arn: "${DoraComputerLambdaArn}",
      },
    ],
  },
  {
    ruleName: "ollinai-correlation-to-recommendations",
    description:
      "Routes correlation.created events to Recommendation Engine for actionable suggestions",
    eventBusName: EVENT_BUS_NAME,
    eventPattern: {
      source: [EVENT_SOURCES.CORRELATOR],
      "detail-type": [EVENT_DETAIL_TYPES.CORRELATION_CREATED],
    },
    targets: [
      {
        id: "recommendation-engine-lambda",
        arn: "${RecommendationEngineLambdaArn}",
      },
    ],
  },
  {
    ruleName: "ollinai-deployment-ingested-to-dora",
    description:
      "Routes new deployment events to DORA Computer for incremental metric update",
    eventBusName: EVENT_BUS_NAME,
    eventPattern: {
      source: [EVENT_SOURCES.INGESTION],
      "detail-type": [EVENT_DETAIL_TYPES.DEPLOYMENT_INGESTED],
    },
    targets: [
      {
        id: "dora-computer-lambda",
        arn: "${DoraComputerLambdaArn}",
      },
    ],
  },
  {
    ruleName: "ollinai-incident-ingested-to-dora",
    description:
      "Routes new incidents to DORA Computer for MTTR and CFR recomputation",
    eventBusName: EVENT_BUS_NAME,
    eventPattern: {
      source: [EVENT_SOURCES.INGESTION],
      "detail-type": [EVENT_DETAIL_TYPES.INCIDENT_INGESTED],
    },
    targets: [
      {
        id: "dora-computer-lambda",
        arn: "${DoraComputerLambdaArn}",
      },
    ],
  },
  {
    ruleName: "ollinai-high-risk-to-recommendations",
    description:
      "Routes high/critical risk score events to Recommendation Engine",
    eventBusName: EVENT_BUS_NAME,
    eventPattern: {
      source: [EVENT_SOURCES.RISK_SCORER],
      "detail-type": [EVENT_DETAIL_TYPES.RISK_SCORE_COMPUTED],
      detail: {
        riskScore: ["high", "critical"],
      },
    },
    targets: [
      {
        id: "recommendation-engine-lambda",
        arn: "${RecommendationEngineLambdaArn}",
      },
    ],
  },
];

/**
 * Generates CloudFormation-compatible resource definitions for EventBridge rules.
 */
export function generateCloudFormationResources() {
  const resources: Record<string, unknown> = {};

  // Event Bus
  resources["OllinaiEventBus"] = {
    Type: "AWS::Events::EventBus",
    Properties: {
      Name: EVENT_BUS_NAME,
    },
  };

  // Rules
  for (const rule of eventBridgeRuleDefinitions) {
    const logicalId = toCfnLogicalId(rule.ruleName);

    resources[logicalId] = {
      Type: "AWS::Events::Rule",
      Properties: {
        Name: rule.ruleName,
        Description: rule.description,
        EventBusName: { Ref: "OllinaiEventBus" },
        EventPattern: rule.eventPattern,
        State: "ENABLED",
        Targets: rule.targets.map((target) => ({
          Id: target.id,
          Arn: target.arn,
          ...(target.inputPath ? { InputPath: target.inputPath } : {}),
        })),
      },
      DependsOn: ["OllinaiEventBus"],
    };
  }

  return resources;
}

/**
 * Converts a rule name to a CloudFormation-compatible logical ID.
 */
function toCfnLogicalId(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
