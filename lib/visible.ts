/** Polls only while Milan looks at the Studio: a hidden tab (another tab, minimised window) asks nothing. */
export const pageVisible = () => typeof document === "undefined" || document.visibilityState === "visible";
