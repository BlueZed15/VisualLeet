// The legacy jQuery plugins bundled with pytutor.ts (jsPlumb, jQuery UI, bbq,
// doTimeout) expect jQuery as a browser global. The old Webpack config used
// ProvidePlugin for this; with esbuild we expose it once, explicitly.
// @ts-ignore - legacy library without typings
import jQuery from "../../../OnlinePythonTutor-Backup/v5-unity/js/lib/jquery-3.0.0.min.js";
(globalThis as any).jQuery = (globalThis as any).$ = jQuery;
