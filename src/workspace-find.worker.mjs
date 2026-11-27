import { searchWorkspace } from "../core/workspace-find.mjs";

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ groups: searchWorkspace(data.files, data.options) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
