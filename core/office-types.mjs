export const officeKind = name => /\.xlsx$/i.test(name) ? "xlsx" : /\.pptx$/i.test(name) ? "pptx" : null;
export const isOfficeKind = kind => kind === "xlsx" || kind === "pptx";
