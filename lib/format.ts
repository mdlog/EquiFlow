export const fmt = {
  usd: (n: number, dp = 2) =>
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }),
  num: (n: number, dp = 2) =>
    n.toLocaleString("en-US", {
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }),
  abbr: (n: number) => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toFixed(0);
  },
  pct: (n: number, dp = 2, sign = false) =>
    (sign && n > 0 ? "+" : "") + n.toFixed(dp) + "%",
};
