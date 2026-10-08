// Kadar window: the viewer screens from the Electron app, running on the Rust backend.

import '../src/renderer/style.css'
import './app.css'
import { installViewerBridge } from './bridge'

installViewerBridge()

// Loaded after the bridge exists: the viewer reads `window.viewer` when its modules load.
void import('../src/renderer/viewer').then(({ initViewer }) => initViewer())
