// Bench-only entry: the UNMODIFIED archived renderer, exposed with the same
// API as src/visualizer/index.ts, for old-vs-new comparisons.
import "../src/visualizer/jquery-global";
// @ts-ignore - legacy TypeScript compiled without type checking
import { ExecutionVisualizer } from "../../OnlinePythonTutor-Backup/v5-unity/js/pytutor";

function renderTrace(containerId: string, trace: unknown, options: Record<string, unknown> = {}) {
  const container = document.getElementById(containerId)!;
  container.replaceChildren();
  const viz = new ExecutionVisualizer(containerId, trace, options);
  return { viz, destroy() { container.replaceChildren(); } };
}

(globalThis as any).VisualLeetRenderer = { renderTrace, ExecutionVisualizer };
