"use client";

import {
	CircleCheckIcon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Sonner Toaster styled to the Prism design tokens (design-system.md 13):
 * 2px radius, surface-raised background, border-strong edges, semantic
 * icon/border colors from the token set. Transient feedback only —
 * persistent states stay inline (banner, AuthAlert, error panels).
 */
const Toaster = ({ ...props }: ToasterProps) => {
	const { theme = "system" } = useTheme();

	return (
		<Sonner
			theme={theme as ToasterProps["theme"]}
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4 text-success" />,
				info: <InfoIcon className="size-4 text-info" />,
				warning: <TriangleAlertIcon className="size-4 text-warning" />,
				error: <OctagonXIcon className="size-4 text-danger" />,
				loading: (
					<Loader2Icon className="size-4 animate-spin text-text-muted" />
				),
			}}
			toastOptions={{
				classNames: {
					toast:
						"!rounded-full !border-border-strong !bg-surface-raised !text-text !text-[13px] !shadow-none",
					title: "!text-[13px] !font-medium !text-text",
					description: "!text-[12px] !text-text-muted",
					actionButton:
						"!rounded-full !bg-accent !text-primary-foreground !h-8 !px-3 !text-[13px] !font-medium",
					cancelButton:
						"!rounded-full !bg-surface-hover !text-text !h-8 !px-3 !text-[13px]",
					closeButton: "!text-text-muted",
				},
			}}
			offset={16}
			gap={8}
			style={
				{
					"--normal-bg": "var(--surface-raised)",
					"--normal-text": "var(--text)",
					"--normal-border": "var(--border-strong)",
					"--success-bg": "var(--surface-raised)",
					"--success-text": "var(--text)",
					"--success-border": "var(--success)",
					"--error-bg": "var(--surface-raised)",
					"--error-text": "var(--text)",
					"--error-border": "var(--danger)",
					"--warning-bg": "var(--surface-raised)",
					"--warning-text": "var(--text)",
					"--warning-border": "var(--warning)",
					"--info-bg": "var(--surface-raised)",
					"--info-text": "var(--text)",
					"--info-border": "var(--info)",
					"--border-radius": "2px",
				} as React.CSSProperties
			}
			{...props}
		/>
	);
};

export { Toaster };
