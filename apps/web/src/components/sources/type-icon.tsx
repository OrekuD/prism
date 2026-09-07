import { Globe, Server, Smartphone } from "lucide-react";

export function TypeIcon({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  const cls = className ?? "size-4";
  if (type === "web") return <Globe className={cls} aria-hidden="true" />;
  if (type === "mobile")
    return <Smartphone className={cls} aria-hidden="true" />;
  return <Server className={cls} aria-hidden="true" />;
}
