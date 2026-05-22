import { defineSimulation } from "../../types.ts"
import { inputSuspendCrashRecoveryDriver } from "./driver.ts"
import { inputSuspendCrashRecoveryHost } from "./host.ts"

export default defineSimulation({
  id: "input-suspend-crash-recovery",
  description:
    "S1 (axis-2 durability gap, CLOSED by tf-12q9): a body parked on "
    + "Workflow.suspend waiting for a workflow-owned table input is re-armed by "
    + "engine reconstruction via the restart recovery sweep "
    + "(recoverSuspendedExecutions), symmetric with the clock wakeup recovery. "
    + "Probes A (crash between write & resume) + B (restart while parked) both "
    + "auto-recover with no external re-drive; C (clock recovery) stays green as "
    + "a no-regression control. Over the real DurableStreamsWorkflowEngine.",
  host: inputSuspendCrashRecoveryHost,
  driver: inputSuspendCrashRecoveryDriver,
})
