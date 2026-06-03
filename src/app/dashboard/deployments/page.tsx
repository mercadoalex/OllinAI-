import { DeploymentsClient } from "./deployments-client"

export const metadata = {
  title: "Deployments | OllinAI",
  description: "Deployment timeline and risk analysis",
}

export default function DeploymentsPage() {
  return <DeploymentsClient />
}
