export const COUNTRIES: [string, string][] = [["US", "United States"], ["GB", "United Kingdom"], ["IN", "India"], ["CA", "Canada"], ["DE", "Germany"], ["BR", "Brazil"], ["MX", "Mexico"], ["AU", "Australia"], ["FR", "France"], ["JP", "Japan"]];
export const countryName = (c: string) => COUNTRIES.find(([k]) => k === c)?.[1] ?? c;
