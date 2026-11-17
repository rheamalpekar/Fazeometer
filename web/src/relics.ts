// The thirty relics of the free build (the ship), shown on the landing page. Names match server/src/seed.ts.
export const RELICS = [
  "Keel", "Port Hull Planks", "Starboard Hull Planks", "Deck", "Prow Figurehead", "Bronze Ram",
  "Stern Post", "Mast", "Main Yard", "Crimson Sail", "Sun Emblem", "Fore Rigging",
  "Aft Rigging", "Anchor", "Port Steering Oar", "Starboard Steering Oar", "Port Oar I", "Port Oar II",
  "Starboard Oar I", "Starboard Oar II", "Port Shield Row", "Starboard Shield Row", "Port Gold Trim", "Starboard Gold Trim",
  "Stern Lantern", "Wine Jars", "Cargo Crates", "Navigator's Compass", "War Banner", "Odyssey Crest",
];

export const relicRarity = (position: number) => (position >= 28 ? "legendary" : position >= 23 ? "epic" : position >= 12 ? "rare" : "common");
