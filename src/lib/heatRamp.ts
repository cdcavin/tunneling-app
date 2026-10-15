/** Diverging ramp for the tunnel heat map: red = worse, through amber, to green = better. */
export const HEAT_RAMP = ["#c0392b", "#d9534f", "#e8865c", "#f0b35b", "#e6d35a", "#b9d45a", "#7cc15b", "#3fa65a", "#1e8449"];
/** Text color that reads on a given ramp step. */
export const heatInk = (i: number) => (i <= 1 || i >= 7 ? "#ffffff" : "#1b1b1b");
/** 0..1 "goodness" to a ramp index. */
export const heatBin = (f: number) => Math.min(HEAT_RAMP.length - 1, Math.max(0, Math.floor(f * HEAT_RAMP.length)));
