/*
 * Jadges profile badges for Vencord
 * Displays approved Jadges badges in Discord's native User Badges row.
 */

import { addProfileBadge, BadgePosition, type BadgeUserArgs, type ProfileBadge, removeProfileBadge } from "@api/Badges";
import { Settings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

interface JadgesBadge {
    name?: string;
    tooltip?: string;
    badge: string;
    localImage?: string;
}

type JadgesResponse = Record<string, JadgesBadge[]>;

const DEFAULT_API_URL = "https://jadges.onrender.com/badges.json";
const REFRESH_INTERVAL = 60_000;

let badgeData: JadgesResponse = {};
let refreshTimer: ReturnType<typeof setInterval> | undefined;
const objectUrls = new Map<string, string>();

function normalizeApiUrl(value: unknown): string {
    const url = typeof value === "string" ? value.trim() : "";
    return url || DEFAULT_API_URL;
}

async function fetchLocalImage(url: string): Promise<string> {
    const cached = objectUrls.get(url);
    if (cached) return cached;

    const response = await fetch(url, {
        cache: "no-store",
        credentials: "omit"
    });

    if (!response.ok) {
        throw new Error(`Badge image returned HTTP ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
        throw new TypeError(`Badge URL returned ${blob.type || "an unknown content type"}`);
    }

    const objectUrl = URL.createObjectURL(blob);
    objectUrls.set(url, objectUrl);
    return objectUrl;
}

async function prepareBadgeData(data: JadgesResponse): Promise<JadgesResponse> {
    const output: JadgesResponse = {};

    await Promise.all(Object.entries(data).map(async ([userId, badges]) => {
        if (!Array.isArray(badges)) return;

        output[userId] = await Promise.all(badges.map(async badge => {
            if (!badge || typeof badge.badge !== "string" || !badge.badge.startsWith("https://")) {
                return badge;
            }

            try {
                return {
                    ...badge,
                    localImage: await fetchLocalImage(badge.badge)
                };
            } catch (error) {
                console.error(`[JadgesBadges v7] Failed to prepare ${badge.badge}:`, error);
                return badge;
            }
        }));
    }));

    return output;
}

async function refreshBadges(): Promise<void> {
    const apiUrl = normalizeApiUrl(Settings.plugins.JadgesBadges?.apiUrl);

    try {
        const response = await fetch(apiUrl, {
            cache: "no-store",
            credentials: "omit"
        });

        if (!response.ok) {
            throw new Error(`Jadges API returned HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new TypeError("Jadges API returned an invalid response");
        }

        badgeData = await prepareBadgeData(data as JadgesResponse);
        const count = Object.values(badgeData).reduce((total, badges) => total + badges.length, 0);
        console.warn(`[JadgesBadges v7] Loaded ${count} native badge(s) with local images.`);
    } catch (error) {
        console.error("[JadgesBadges v7] Failed to refresh badges:", error);
    }
}

function getBadges({ userId }: BadgeUserArgs): ProfileBadge[] {
    const badges = badgeData[userId];
    if (!Array.isArray(badges)) return [];

    return badges
        .filter(badge => badge && typeof badge.badge === "string")
        .map((badge, index) => {
            const description = badge.tooltip || badge.name || "Jadges Badge";
            const id = `jadges_${userId}_${index}`;

            return {
                id,
                key: id,
                description,
                image: badge.localImage || badge.badge,
                position: BadgePosition.END,
                props: {
                    alt: " ",
                    "aria-hidden": true,
                    style: {
                        width: "20px",
                        height: "20px",
                        objectFit: "contain"
                    }
                }
            } satisfies ProfileBadge & { id: string; };
        });
}

const profileBadge: ProfileBadge = {
    getBadges,
    position: BadgePosition.END
};

export default definePlugin({
    name: "JadgesBadges",
    description: "Displays approved Jadges badges in Discord's native profile badge row.",
    authors: [{ name: "Jaycord", id: 0n }],

    options: {
        apiUrl: {
            type: OptionType.STRING,
            description: "Full Jadges badges.json API URL",
            default: DEFAULT_API_URL,
            restartNeeded: true
        }
    },

    async start() {
        console.warn("[JadgesBadges v7] Starting native-hover build.");
        addProfileBadge(profileBadge);
        await refreshBadges();

        clearInterval(refreshTimer);
        refreshTimer = setInterval(() => void refreshBadges(), REFRESH_INTERVAL);
    },

    stop() {
        removeProfileBadge(profileBadge);
        clearInterval(refreshTimer);
        refreshTimer = undefined;
        badgeData = {};

        for (const objectUrl of objectUrls.values()) {
            URL.revokeObjectURL(objectUrl);
        }
        objectUrls.clear();
    }
});
