/*
 * Jadges profile badges for Vencord
 * Displays approved Jadges badges in Discord's native User Badges row.
 */

import { addProfileBadge, BadgePosition, type BadgeUserArgs, type ProfileBadge, removeProfileBadge } from "@api/Badges";
import { Settings } from "@api/Settings";
import { relaunch } from "@utils/native";
import definePlugin, { OptionType } from "@utils/types";
import { ConfirmModal, openModal } from "@webpack/common";

interface JadgesBadge {
    name?: string;
    tooltip?: string;
    badge: string;
    embeddedImage?: string;
}

type JadgesResponse = Record<string, JadgesBadge[]>;

const DEFAULT_API_URL = "https://jadges.onrender.com/badges.json";
const REFRESH_INTERVAL = 60_000;
const CSP_DIRECTIVES = ["connect-src", "img-src"];

let badgeData: JadgesResponse = {};
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let restartModalShown = false;
const imageCache = new Map<string, string>();

function normalizeApiUrl(value: unknown): string {
    const url = typeof value === "string" ? value.trim() : "";
    return url || DEFAULT_API_URL;
}

function showRestartRequired(): void {
    if (restartModalShown) return;
    restartModalShown = true;

    openModal(props => (
        <ConfirmModal
            {...props}
            title="Restart Vencord"
            subtitle="JadgesBadges has enabled access to the Jadges service. Restart Discord once to apply it."
            confirmText="Restart now"
            cancelText="Later"
            variant="primary"
            onConfirm={relaunch}
        />
    ));
}

async function isHostReady(apiUrl: string): Promise<boolean> {
    if (IS_WEB) return true;

    try {
        return await VencordNative.csp.isDomainAllowed(
            new URL(apiUrl).origin,
            CSP_DIRECTIVES
        );
    } catch {
        console.error("[JadgesBadges] Invalid API URL:", apiUrl);
        return false;
    }
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") resolve(reader.result);
            else reject(new TypeError("Could not convert badge image to a data URL"));
        };
        reader.onerror = () => reject(reader.error ?? new Error("Could not read badge image"));
        reader.readAsDataURL(blob);
    });
}

async function fetchEmbeddedImage(url: string, noCache: boolean): Promise<string> {
    const cached = imageCache.get(url);
    if (cached) return cached;

    const response = await fetch(url, {
        cache: noCache ? "no-store" : "force-cache",
        credentials: "omit"
    });

    if (!response.ok) {
        throw new Error(`Badge image returned HTTP ${response.status}`);
    }

    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
        throw new TypeError(`Badge URL returned ${blob.type || "an unknown content type"}`);
    }

    const dataUrl = await blobToDataUrl(blob);
    imageCache.set(url, dataUrl);
    return dataUrl;
}

async function embedBadgeImages(data: JadgesResponse, noCache: boolean): Promise<JadgesResponse> {
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
                    embeddedImage: await fetchEmbeddedImage(badge.badge, noCache)
                };
            } catch (error) {
                console.error(`[JadgesBadges] Failed to prepare image ${badge.badge}:`, error);
                return badge;
            }
        }));
    }));

    return output;
}

async function refreshBadges(noCache = false): Promise<void> {
    const apiUrl = normalizeApiUrl(Settings.plugins.JadgesBadges?.apiUrl);

    try {
        const response = await fetch(apiUrl, {
            cache: noCache ? "no-store" : "default",
            credentials: "omit"
        });

        if (!response.ok) {
            throw new Error(`Jadges API returned HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new TypeError("Jadges API returned an invalid response");
        }

        badgeData = await embedBadgeImages(data as JadgesResponse, noCache);
    } catch (error) {
        console.error("[JadgesBadges] Failed to refresh badges:", error);
    }
}

function getBadges({ userId }: BadgeUserArgs): ProfileBadge[] {
    const badges = badgeData[userId];
    if (!Array.isArray(badges)) return [];

    return badges
        .filter(badge => badge && typeof badge.badge === "string" && badge.badge.startsWith("https://"))
        .map((badge, index) => {
            const description = badge.tooltip || badge.name || "Jadges Badge";
            const id = `jadges_${userId}_${index}`;

            return {
                id,
                key: id,
                description,
                image: badge.embeddedImage || badge.badge,
                position: BadgePosition.END,
                props: {
                    alt: description,
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
        addProfileBadge(profileBadge);

        const apiUrl = normalizeApiUrl(Settings.plugins.JadgesBadges?.apiUrl);
        if (!(await isHostReady(apiUrl))) {
            showRestartRequired();
            return;
        }

        await refreshBadges(true);

        clearInterval(refreshTimer);
        refreshTimer = setInterval(() => void refreshBadges(false), REFRESH_INTERVAL);
    },

    stop() {
        removeProfileBadge(profileBadge);
        clearInterval(refreshTimer);
        refreshTimer = undefined;
        badgeData = {};
        imageCache.clear();
        restartModalShown = false;
    }
});
