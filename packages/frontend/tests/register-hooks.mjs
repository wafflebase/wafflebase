/**
 * Registers the custom resolve hooks for frontend unit tests.
 * Used with: node --import ./tests/register-hooks.mjs
 */
import { register } from "node:module";

register("./resolve-hooks.mjs", import.meta.url);
