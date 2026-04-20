// Curated Google Fonts cho designer. `vietnamese: true` = font hỗ trợ tiếng Việt đầy đủ.
export type FontCategory = "Sans" | "Serif" | "Display" | "Script" | "Mono";

export interface FontDef {
  family: string;
  category: FontCategory;
  vietnamese: boolean;
  weights: number[];
  italic?: boolean;
}

export const FONTS: FontDef[] = [
  // Sans (Vietnamese-ready)
  { family: "Be Vietnam Pro", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: "Inter", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: "Manrope", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700, 800] },
  { family: "Plus Jakarta Sans", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700, 800], italic: true },
  { family: "DM Sans", category: "Sans", vietnamese: true, weights: [400, 500, 700, 900], italic: true },
  { family: "Lexend", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700, 800, 900] },
  { family: "Outfit", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700, 800, 900] },
  { family: "Sora", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700, 800] },
  { family: "Space Grotesk", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700] },
  // Sans bold/poster
  { family: "Archivo Black", category: "Display", vietnamese: true, weights: [400] },
  { family: "Anton", category: "Display", vietnamese: true, weights: [400] },
  { family: "Barlow Condensed", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: "Bebas Neue", category: "Display", vietnamese: false, weights: [400] },
  { family: "Oswald", category: "Sans", vietnamese: true, weights: [400, 500, 600, 700] },
  // Serif
  { family: "Playfair Display", category: "Serif", vietnamese: true, weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: "Lora", category: "Serif", vietnamese: true, weights: [400, 500, 600, 700], italic: true },
  { family: "Cormorant Garamond", category: "Serif", vietnamese: true, weights: [400, 500, 600, 700], italic: true },
  { family: "EB Garamond", category: "Serif", vietnamese: true, weights: [400, 500, 600, 700, 800], italic: true },
  { family: "Bitter", category: "Serif", vietnamese: true, weights: [400, 500, 600, 700, 800], italic: true },
  { family: "Merriweather", category: "Serif", vietnamese: true, weights: [400, 700, 900], italic: true },
  // Display/funky
  { family: "Fraunces", category: "Display", vietnamese: true, weights: [400, 500, 600, 700, 800, 900], italic: true },
  { family: "Unbounded", category: "Display", vietnamese: true, weights: [400, 500, 600, 700, 800, 900] },
  { family: "Bricolage Grotesque", category: "Display", vietnamese: true, weights: [400, 500, 600, 700, 800] },
  // Script
  { family: "Pacifico", category: "Script", vietnamese: true, weights: [400] },
  { family: "Caveat", category: "Script", vietnamese: true, weights: [400, 500, 600, 700] },
  { family: "Dancing Script", category: "Script", vietnamese: true, weights: [400, 500, 600, 700] },
  { family: "Great Vibes", category: "Script", vietnamese: false, weights: [400] },
  { family: "Sacramento", category: "Script", vietnamese: false, weights: [400] },
  // Mono
  { family: "JetBrains Mono", category: "Mono", vietnamese: true, weights: [400, 500, 600, 700, 800], italic: true },
  { family: "IBM Plex Mono", category: "Mono", vietnamese: true, weights: [400, 500, 600, 700], italic: true },
];

export const FONT_CATEGORIES: FontCategory[] = ["Sans", "Serif", "Display", "Script", "Mono"];

/** Build URL Google Fonts duy nhất, gộp tất cả family với weight + italic đầy đủ. */
export function buildGoogleFontsUrl(): string {
  const parts = FONTS.map((f) => {
    const family = f.family.replace(/ /g, "+");
    const weights = f.weights.join(";");
    if (f.italic) {
      const ital = f.weights.map((w) => `0,${w}`).concat(f.weights.map((w) => `1,${w}`)).join(";");
      return `family=${family}:ital,wght@${ital}`;
    }
    return `family=${family}:wght@${weights}`;
  });
  return `https://fonts.googleapis.com/css2?${parts.join("&")}&display=swap`;
}

export function getFont(family?: string): FontDef | undefined {
  if (!family) return undefined;
  return FONTS.find((f) => f.family === family);
}
