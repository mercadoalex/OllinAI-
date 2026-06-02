import { describe, it, expect } from "vitest";
import {
  allTables,
  eventsTable,
  incidentsTable,
  metricsTable,
  configTable,
  auditTable,
  TableDefinition,
} from "../../infra/dynamodb-tables";

describe("DynamoDB Table Definitions", () => {
  describe("allTables", () => {
    it("contains exactly 5 Phase 1 tables", () => {
      expect(allTables).toHaveLength(5);
    });

    it("all tables use PAY_PER_REQUEST billing", () => {
      for (const table of allTables) {
        expect(table.BillingMode).toBe("PAY_PER_REQUEST");
      }
    });

    it("all tables have PK (HASH) and SK (RANGE) key schema", () => {
      for (const table of allTables) {
        expect(table.KeySchema).toContainEqual({
          AttributeName: "PK",
          KeyType: "HASH",
        });
        expect(table.KeySchema).toContainEqual({
          AttributeName: "SK",
          KeyType: "RANGE",
        });
      }
    });

    it("all tables have Project and ManagedBy tags", () => {
      for (const table of allTables) {
        expect(table.Tags).toContainEqual({
          Key: "Project",
          Value: "OllinAI",
        });
        expect(table.Tags).toContainEqual({
          Key: "ManagedBy",
          Value: "CloudFormation",
        });
      }
    });
  });

  describe("ollinai-events table", () => {
    it("has the correct table name", () => {
      expect(eventsTable.TableName).toBe("ollinai-events");
    });

    it("has 3 GSIs for correlation, team view, and deduplication", () => {
      expect(eventsTable.GlobalSecondaryIndexes).toHaveLength(3);
    });

    it("GSI-1 is named GSI1-CorrelationLookup with ALL projection", () => {
      const gsi = eventsTable.GlobalSecondaryIndexes![0];
      expect(gsi.IndexName).toBe("GSI1-CorrelationLookup");
      expect(gsi.Projection.ProjectionType).toBe("ALL");
      expect(gsi.KeySchema).toContainEqual({
        AttributeName: "GSI1PK",
        KeyType: "HASH",
      });
      expect(gsi.KeySchema).toContainEqual({
        AttributeName: "GSI1SK",
        KeyType: "RANGE",
      });
    });

    it("GSI-2 is named GSI2-TeamView with ALL projection", () => {
      const gsi = eventsTable.GlobalSecondaryIndexes![1];
      expect(gsi.IndexName).toBe("GSI2-TeamView");
      expect(gsi.Projection.ProjectionType).toBe("ALL");
    });

    it("GSI-3 is named GSI3-Deduplication with KEYS_ONLY projection", () => {
      const gsi = eventsTable.GlobalSecondaryIndexes![2];
      expect(gsi.IndexName).toBe("GSI3-Deduplication");
      expect(gsi.Projection.ProjectionType).toBe("KEYS_ONLY");
    });

    it("defines all required attribute definitions for keys and GSIs", () => {
      const attributeNames = eventsTable.AttributeDefinitions.map(
        (a) => a.AttributeName
      );
      expect(attributeNames).toContain("PK");
      expect(attributeNames).toContain("SK");
      expect(attributeNames).toContain("GSI1PK");
      expect(attributeNames).toContain("GSI1SK");
      expect(attributeNames).toContain("GSI2PK");
      expect(attributeNames).toContain("GSI2SK");
      expect(attributeNames).toContain("GSI3PK");
      expect(attributeNames).toContain("GSI3SK");
    });
  });

  describe("ollinai-incidents table", () => {
    it("has the correct table name", () => {
      expect(incidentsTable.TableName).toBe("ollinai-incidents");
    });

    it("has 1 GSI for time range queries", () => {
      expect(incidentsTable.GlobalSecondaryIndexes).toHaveLength(1);
    });

    it("GSI-1 is named GSI1-TimeRange with ALL projection", () => {
      const gsi = incidentsTable.GlobalSecondaryIndexes![0];
      expect(gsi.IndexName).toBe("GSI1-TimeRange");
      expect(gsi.Projection.ProjectionType).toBe("ALL");
    });
  });

  describe("ollinai-metrics table", () => {
    it("has the correct table name", () => {
      expect(metricsTable.TableName).toBe("ollinai-metrics");
    });

    it("has no GSIs", () => {
      expect(metricsTable.GlobalSecondaryIndexes).toBeUndefined();
    });
  });

  describe("ollinai-config table", () => {
    it("has the correct table name", () => {
      expect(configTable.TableName).toBe("ollinai-config");
    });

    it("has no GSIs", () => {
      expect(configTable.GlobalSecondaryIndexes).toBeUndefined();
    });
  });

  describe("ollinai-audit table", () => {
    it("has the correct table name", () => {
      expect(auditTable.TableName).toBe("ollinai-audit");
    });

    it("has no GSIs", () => {
      expect(auditTable.GlobalSecondaryIndexes).toBeUndefined();
    });
  });

  describe("table definition validity", () => {
    function validateTable(table: TableDefinition) {
      // All key schema attributes must be in attribute definitions
      const definedAttributes = new Set(
        table.AttributeDefinitions.map((a) => a.AttributeName)
      );

      for (const key of table.KeySchema) {
        expect(definedAttributes.has(key.AttributeName)).toBe(true);
      }

      if (table.GlobalSecondaryIndexes) {
        for (const gsi of table.GlobalSecondaryIndexes) {
          for (const key of gsi.KeySchema) {
            expect(definedAttributes.has(key.AttributeName)).toBe(true);
          }
        }
      }
    }

    it("events table has valid attribute references", () => {
      validateTable(eventsTable);
    });

    it("incidents table has valid attribute references", () => {
      validateTable(incidentsTable);
    });

    it("metrics table has valid attribute references", () => {
      validateTable(metricsTable);
    });

    it("config table has valid attribute references", () => {
      validateTable(configTable);
    });

    it("audit table has valid attribute references", () => {
      validateTable(auditTable);
    });
  });
});
