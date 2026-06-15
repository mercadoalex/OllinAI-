# Requirements Document

## Introduction

The OllinAI dashboard currently displays four DORA metrics (Deployment Frequency, Lead Time, Change Failure Rate, MTTR) and a risk score distribution histogram. Engineering teams need a comprehensive view that goes beyond DORA to understand risk trends, incident correlations, team performance comparisons, service health, ML prediction effectiveness, and business impact. This feature adds six new metric categories to the dashboard, each backed by data from existing DynamoDB tables (ollinai-events, ollinai-incidents, ollinai-metrics, ollinai-config) and served via new API endpoints compatible with the existing Next.js 14 ISR architecture with 30-second revalidation.

## Glossary

- **Dashboard**: The OllinAI web interface rendered as a Next.js server component with client-side polling for near-real-time updates
- **Risk_Trend**: A time-series representation of high and critical Risk_Score deployments aggregated by day or week
- **Incident_Correlation_Rate**: The percentage of Incidents that have at least one correlated Deployment_Event relative to total Incidents in a time range
- **Time_To_Correlation**: The elapsed time in seconds between Incident persistence and the completion of correlation link generation
- **Uncorrelated_Incident**: An Incident with correlationStatus equal to "uncorrelated" (no matching Deployment_Events found within the Correlation_Window)
- **Service_At_Risk**: A Service that has received at least one high or critical Risk_Score deployment within the most recent 7 days
- **Blast_Radius**: The count of distinct Services affected by a single Incident or correlated set of Incidents
- **Gate_Decision**: The outcome of the deployment gate evaluation: "blocked", "warned", or "allowed"
- **Prediction_Accuracy**: The percentage of ML_Model predictions where the predicted outcome matched the actual outcome (incident or no incident) within the Correlation_Window
- **False_Positive_Rate**: The percentage of deployments where the ML_Model predicted an incident (prediction score above the configured threshold) but no incident occurred within the Correlation_Window
- **Estimated_Downtime_Avoided**: A derived metric computing the average MTTR multiplied by the number of blocked deployments that had a high or critical predicted risk
- **SLA_Compliance_Percentage**: The percentage of time within a period where no critical-severity Incident was active, relative to total period duration
- **Metric_Card**: A single dashboard widget displaying a numeric value, unit, and optional trend indicator
- **Metric_Section**: A logical grouping of related Metric_Cards under a labeled heading on the dashboard

## Requirements

### Requirement 1: Risk Metrics Section

**User Story:** As an engineering manager, I want to see risk score trends and per-service averages, so that I can understand whether deployments are becoming riskier over time.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Risk Metrics section containing three Metric_Cards: Risk_Score distribution (histogram by severity), high/critical deploy trend over time (line chart), and average risk score per Service (bar chart)
2. WHEN a user views the Risk Metrics section, THE Dashboard SHALL compute the high/critical deploy trend as the count of Deployment_Events with Risk_Score "high" or "critical" grouped by day for the selected time range
3. WHEN a user views the Risk Metrics section, THE Dashboard SHALL compute the average risk score per Service by mapping Risk_Score values to numeric equivalents (low=1, medium=2, high=3, critical=4), averaging across all Deployment_Events per Service within the selected time range, and displaying the top 10 Services sorted by descending average
4. THE Dashboard SHALL filter all Risk Metrics by the active Team, Service, and time range selections consistent with the existing dashboard filter behavior
5. IF fewer than 3 Deployment_Events exist for the selected scope and time range, THEN THE Dashboard SHALL display an "insufficient data" indicator in the Risk Metrics section rather than rendering potentially misleading visualizations
6. WHEN new Deployment_Events are ingested, THE Dashboard SHALL reflect updated Risk Metrics within 30 seconds without requiring a manual page refresh

### Requirement 2: Correlation Metrics Section

**User Story:** As an SRE, I want to see how effectively the system correlates incidents with deployments, so that I can trust the root cause identification and tune correlation windows.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Correlation Metrics section containing three Metric_Cards: Incident_Correlation_Rate (percentage), average Time_To_Correlation (seconds), and Uncorrelated_Incident count
2. WHEN a user views the Correlation Metrics section, THE Dashboard SHALL compute Incident_Correlation_Rate as the count of Incidents with correlationStatus "correlated" divided by total Incidents within the selected time range, expressed as a percentage
3. WHEN a user views the Correlation Metrics section, THE Dashboard SHALL compute average Time_To_Correlation as the mean elapsed time between Incident detection timestamp and the timestamp when correlation links were created for all correlated Incidents within the selected time range
4. WHEN a user views the Correlation Metrics section, THE Dashboard SHALL display the count of Incidents with correlationStatus "uncorrelated" within the selected time range
5. THE Dashboard SHALL display trend indicators for Incident_Correlation_Rate and Uncorrelated_Incident count by comparing the current period to the immediately preceding period of equal length, using the same 10-percent threshold as DORA trend computation
6. IF no Incidents exist for the selected scope and time range, THEN THE Dashboard SHALL display zero values for Incident_Correlation_Rate and Uncorrelated_Incident count with an informational note stating "No incidents in selected period"

### Requirement 3: Team Performance Metrics Section

**User Story:** As a VP of Engineering, I want to compare team performance side by side, so that I can identify teams needing support and share best practices from high-performing teams.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Team Performance section containing three visualizations: per-Team Change_Failure_Rate comparison (bar chart), Deployment_Frequency by Team (bar chart), and Team risk profile comparison (stacked bar chart showing Risk_Score distribution per Team)
2. WHEN a user views the Team Performance section, THE Dashboard SHALL compute Change_Failure_Rate per Team as the percentage of each Team's Deployment_Events that have correlated Incidents within the selected time range
3. WHEN a user views the Team Performance section, THE Dashboard SHALL compute Deployment_Frequency per Team as the count of Deployment_Events per Team within the selected time range
4. WHEN a user views the Team Performance section, THE Dashboard SHALL compute the risk profile per Team as the count of Deployment_Events per Risk_Score severity (low, medium, high, critical) per Team within the selected time range
5. THE Dashboard SHALL display Teams sorted by Change_Failure_Rate in descending order by default, with an option to sort by Deployment_Frequency or average Risk_Score
6. IF a Team has fewer than 3 Deployment_Events in the selected time range, THEN THE Dashboard SHALL display that Team with an "insufficient data" indicator rather than computed metrics
7. WHEN no Team filter is active, THE Dashboard SHALL display data for all Teams within the Tenant; WHEN a Team filter is active, THE Dashboard SHALL display only the selected Team's metrics with an organization-wide average overlay for comparison

### Requirement 4: Service Health Metrics Section

**User Story:** As a platform engineer, I want to quickly identify services that are at risk and understand the blast radius of incidents, so that I can prioritize stabilization efforts.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Service Health section containing three components: Services at Risk count with expandable list, service-level DORA metrics drill-down table, and Blast_Radius metric per recent Incident
2. WHEN a user views the Service Health section, THE Dashboard SHALL compute Services at Risk as the count and list of Services that received at least one Deployment_Event with Risk_Score "high" or "critical" within the most recent 7 days
3. WHEN a user expands the Services at Risk list, THE Dashboard SHALL display each Service_At_Risk with its name, count of high/critical deployments in the last 7 days, and most recent Risk_Score
4. THE Dashboard SHALL display a service-level DORA metrics table showing Deployment_Frequency, Lead_Time, Change_Failure_Rate, and MTTR for each Service in the selected time range, sortable by any column
5. WHEN a user views the Service Health section, THE Dashboard SHALL compute Blast_Radius for each Incident as the count of distinct Services affected by that Incident based on correlated Deployment_Event service associations
6. THE Dashboard SHALL display the average Blast_Radius and maximum Blast_Radius for Incidents within the selected time range
7. IF a Service has fewer than 3 Deployment_Events in the selected time range, THEN THE Dashboard SHALL display "insufficient data" for that Service's DORA metrics rather than potentially misleading values

### Requirement 5: Predictions and Prevention Metrics Section

**User Story:** As a team lead, I want to understand how effectively the ML model and deployment gate prevent incidents, so that I can trust automated decisions and calibrate thresholds.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Predictions and Prevention section containing four Metric_Cards: Prediction_Accuracy (percentage), deployments blocked or warned by the gate (count), False_Positive_Rate (percentage), and early warnings issued (count)
2. WHEN a user views the Predictions and Prevention section, THE Dashboard SHALL compute Prediction_Accuracy as the percentage of Deployment_Events where the ML_Model prediction outcome (incident predicted vs. not predicted, using the configured threshold) matched the actual outcome (incident correlated vs. not correlated) within the selected time range
3. WHEN a user views the Predictions and Prevention section, THE Dashboard SHALL display the count of Deployment_Events with Gate_Decision "blocked" and the count with Gate_Decision "warned" within the selected time range
4. WHEN a user views the Predictions and Prevention section, THE Dashboard SHALL compute False_Positive_Rate as the percentage of Deployment_Events where predictionScore exceeded the configured threshold but no Incident was correlated within the Correlation_Window, relative to all Deployment_Events with predictionScore above the threshold within the selected time range
5. WHEN a user views the Predictions and Prevention section, THE Dashboard SHALL display the count of early warnings issued (Deployment_Events where earlyWarning is true) within the selected time range
6. IF no ML_Model predictions exist for the selected time range (no Deployment_Events have a predictionScore), THEN THE Dashboard SHALL display "ML model inactive" in place of Prediction_Accuracy and False_Positive_Rate with a message indicating the model requires training data
7. THE Dashboard SHALL display trend indicators for Prediction_Accuracy and False_Positive_Rate by comparing the current period to the preceding period of equal length

### Requirement 6: Business Impact Metrics Section

**User Story:** As a VP of Engineering, I want to quantify the business value of OllinAI in terms of downtime avoided and SLA compliance, so that I can justify continued investment and report to leadership.

#### Acceptance Criteria

1. THE Dashboard SHALL display a Business Impact section containing three Metric_Cards: Estimated_Downtime_Avoided (hours), SLA_Compliance_Percentage, and Incident trend indicator (improving, degrading, or stable)
2. WHEN a user views the Business Impact section, THE Dashboard SHALL compute Estimated_Downtime_Avoided as the count of Deployment_Events with Gate_Decision "blocked" and Risk_Score "high" or "critical" multiplied by the Tenant's average MTTR in hours within the selected time range
3. WHEN a user views the Business Impact section, THE Dashboard SHALL compute SLA_Compliance_Percentage as the percentage of total minutes in the selected time range during which no critical-severity Incident was active (detection timestamp to resolution timestamp), capping unresolved Incidents at the current time
4. WHEN a user views the Business Impact section, THE Dashboard SHALL compute the Incident trend by comparing total Incident count in the current period to the preceding period of equal length: "improving" if the count decreased by more than 10 percent, "degrading" if the count increased by more than 10 percent, and "stable" otherwise
5. IF no deployments were blocked by the gate within the selected time range, THEN THE Dashboard SHALL display Estimated_Downtime_Avoided as "0 hours" with a note stating "No deployments blocked in this period"
6. IF no Incidents with critical severity and a resolution timestamp exist within the selected time range, THEN THE Dashboard SHALL display SLA_Compliance_Percentage as 100 percent

### Requirement 7: Metrics API Endpoints

**User Story:** As a frontend developer, I want dedicated API endpoints for each metric category, so that the dashboard can fetch data efficiently with appropriate caching and pagination.

#### Acceptance Criteria

1. THE OllinAI SHALL expose the following API endpoints: GET /api/metrics/risk (Risk Metrics), GET /api/metrics/correlation (Correlation Metrics), GET /api/metrics/team-performance (Team Performance), GET /api/metrics/service-health (Service Health), GET /api/metrics/predictions (Predictions and Prevention), and GET /api/metrics/business-impact (Business Impact)
2. WHEN an API request is received, THE OllinAI SHALL accept the following common query parameters: from (ISO 8601 timestamp), to (ISO 8601 timestamp), team (optional Team identifier), and service (optional Service identifier)
3. THE OllinAI SHALL scope all metrics API queries to the authenticated Tenant using the tenant identifier from the JWT token or session
4. THE OllinAI SHALL return API responses within 3 seconds for Tenants with up to 10,000 Deployment_Events in the selected time range
5. IF an API request contains an invalid time range (from after to, or range exceeding 365 days), THEN THE OllinAI SHALL return an HTTP 400 response with an error message identifying the validation failure
6. IF an API request references a non-existent Team or Service, THEN THE OllinAI SHALL return an HTTP 400 response identifying the invalid filter parameter
7. WHEN no data exists for the requested scope and time range, THE OllinAI SHALL return an HTTP 200 response with computed metrics showing zero values and appropriate "insufficient data" or "no data" indicators

### Requirement 8: Dashboard Layout and Navigation

**User Story:** As an engineering manager, I want the new metric sections organized logically on the dashboard with clear navigation, so that I can quickly find the information most relevant to my role.

#### Acceptance Criteria

1. THE Dashboard SHALL organize metric sections in the following order: DORA Metrics (existing), Risk Metrics, Correlation Metrics, Team Performance, Service Health, Predictions and Prevention, and Business Impact
2. THE Dashboard SHALL provide a section navigation bar allowing users to jump directly to any Metric_Section without scrolling
3. WHEN a user selects a Metric_Section from the navigation bar, THE Dashboard SHALL scroll the viewport to the selected section with a smooth scroll animation
4. THE Dashboard SHALL render all visible Metric_Sections within 3 seconds for Tenants with up to 10,000 Deployment_Events in the selected time range
5. THE Dashboard SHALL load Metric_Sections progressively: DORA Metrics and Risk Metrics render on initial server response, and remaining sections load via client-side fetches after initial paint
6. WHEN the viewport width is below 768 pixels, THE Dashboard SHALL stack Metric_Cards vertically within each section and collapse the section navigation bar into a dropdown menu
7. THE Dashboard SHALL maintain the existing time range selector and Team/Service filter behavior, applying the active filters to all new Metric_Sections consistently

### Requirement 9: Subscription Tier Access Control for Advanced Metrics

**User Story:** As a product owner, I want advanced metrics gated by subscription tier, so that the feature incentivizes upgrades from the Starter plan.

#### Acceptance Criteria

1. WHILE a Tenant has Starter tier access, THE Dashboard SHALL display only the existing DORA Metrics section and Risk Score distribution histogram, with all new Metric_Sections hidden
2. WHILE a Tenant has Pro tier access, THE Dashboard SHALL display DORA Metrics, Risk Metrics, Correlation Metrics, Team Performance, and Service Health sections
3. WHILE a Tenant has Enterprise tier access, THE Dashboard SHALL display all Metric_Sections including Predictions and Prevention and Business Impact
4. WHEN a Tenant on the Starter or Pro tier navigates to a restricted Metric_Section via direct URL or bookmark, THE Dashboard SHALL display a locked state indicating the required tier with a clear call-to-action to upgrade
5. IF a Tenant upgrades their subscription tier, THEN THE Dashboard SHALL display the newly available Metric_Sections within 60 seconds without requiring a page refresh or data re-ingestion
6. THE OllinAI SHALL enforce tier restrictions at the API level: requests to restricted metric endpoints SHALL return an HTTP 403 response with a message indicating the feature requires a higher tier
