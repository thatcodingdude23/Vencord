/*
 * Jadges native host permissions for Vencord.
 * This module is loaded by Vencord's main process at startup.
 */

import { CspPolicies, ImageSrc } from "@main/csp";

// ImageSrc includes both connect-src and img-src.
// This allows the Jadges JSON API and its badge images without a permission popup.
CspPolicies["jadges.onrender.com"] = ImageSrc;
