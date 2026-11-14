// VisualLeet renderer entry point: wraps the archived Python Tutor
// ExecutionVisualizer so it can be fed an in-memory trace.
import "./jquery-global";
// @ts-ignore - legacy TypeScript compiled without type checking
import { ExecutionVisualizer } from "./pytutor";
import "./visualleet.css";

export interface RenderedTrace {
  viz: any;
  destroy(): void;
}

/** Render `trace` ({code, trace}) into the element with id `containerId`, replacing any previous view. */
export function renderTrace(containerId: string, trace: unknown, options: Record<string, unknown> = {}): RenderedTrace {
  const container = document.getElementById(containerId);
  if (!container) throw new Error(`No element with id ${containerId}`);
  container.replaceChildren();
  const viz = new ExecutionVisualizer(containerId, trace, options);
  return {
    viz,
    destroy() {
      // cancel any pending arrow redraw, then drop the DOM (jQuery 3 keeps
      // handlers/data on the elements themselves, so they go with it)
      viz.dataViz?.jsPlumbInstance?.destroy?.();
      container.replaceChildren();
    },
  };
}

(globalThis as any).VisualLeetRenderer = { renderTrace, ExecutionVisualizer };
