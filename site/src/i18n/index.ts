import { en } from "./en";
import { tr } from "./tr";
import type { Lang } from "./pages";

export const dict = { en, tr };
export const t = (lang: Lang) => dict[lang];
export * from "./pages";
