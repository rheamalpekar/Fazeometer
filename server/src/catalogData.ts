// Static content for the two builds and the demo streamers.

// Free build: a Greek war galley. Second build (subscription): Agamemnon. Each has 30 relics.
export const SHIP_SLOTS = [
  "Keel", "Port Hull Planks", "Starboard Hull Planks", "Deck", "Prow Figurehead", "Bronze Ram",
  "Stern Post", "Mast", "Main Yard", "Crimson Sail", "Sun Emblem", "Fore Rigging",
  "Aft Rigging", "Anchor", "Port Steering Oar", "Starboard Steering Oar", "Port Oar I", "Port Oar II",
  "Starboard Oar I", "Starboard Oar II", "Port Shield Row", "Starboard Shield Row", "Port Gold Trim", "Starboard Gold Trim",
  "Stern Lantern", "Wine Jars", "Cargo Crates", "Navigator's Compass", "War Banner", "Odyssey Crest",
];

export const HERO_SLOTS = [
  "Helm", "Crimson Plume", "Bronze Visor", "Neck Guard", "Left Pauldron", "Right Pauldron",
  "Breastplate", "Voyager Cape", "Belt of Ithaca", "Left Gauntlet", "Right Gauntlet", "Left Greave",
  "Right Greave", "Sandals", "Spear", "Round Shield", "Sword Sheath", "Quiver",
  "Hunting Bow", "Trident", "Wine Flask", "Siren Charm", "Lotus Pendant", "Cyclops Eye",
  "Horse Token", "Sail Banner", "Oar", "Compass", "Ithaca Mantle", "Odyssey Crest",
];

export const rarityOf = (pos: number) => (pos >= 28 ? "legendary" : pos >= 23 ? "epic" : pos >= 12 ? "rare" : "common");

export const TEMPLATES = [
  { game: "any", slot: 1, tier: "free", kind: "ship", name: "Trireme of Ithaca", theme: "Odyssey war galley", color: "#8a5a30", parts: SHIP_SLOTS },
  { game: "any", slot: 2, tier: "premium", kind: "hero", name: "Agamemnon, King of Mycenae", theme: "Bronze and gold king", color: "#d9a441", parts: HERO_SLOTS },
];

export const STREAMERS = [
  { name: "NovaStrike", platform: "twitch", channel: "novastrike", country: "US", followers: 120000, partner: true, game: "cod", color: "#C8102E", email: "nova@faze.dev", bio: "Warzone sweat. Loves long streams and secret drops.", tags: ["warzone", "snipers", "late night"] },
  { name: "RexFN", platform: "youtube", channel: "rexfn", country: "GB", followers: 85000, partner: true, game: "fortnite", color: "#7B4DFF", email: "rex@faze.dev", bio: "Builds, edits, and zero-build pushes.", tags: ["building", "creative", "tournaments"] },
  { name: "LunaPlays", platform: "twitch", channel: "lunaplays", country: "IN", followers: 42000, partner: true, game: "cod", color: "#E8A317", email: "luna@faze.dev", bio: "Mobile and console COD, friendly lobbies.", tags: ["mobile", "community"] },
  { name: "RookieRay", platform: "youtube", channel: "rookieray", country: "US", followers: 12000, partner: false, game: "fortnite", color: "#00B3A4", email: "ray@faze.dev", bio: "Rising creator, not a partner yet.", tags: ["new"] },
];
