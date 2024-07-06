import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { CopyIcon } from "@radix-ui/react-icons";
import React from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

export function ProjectSettingsApiKeys() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useProjectQuery(slug);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>API Keys</CardTitle>
          <CardDescription>Manage your api keys</CardDescription>
        </CardHeader>
        <CardFooter className="border-t px-6 py-4">
          {isLoading ? (
            <Skeleton className="w-full h-6" />
          ) : (
            <div className="w-full flex justify-between items-center">
              <p className="text-sm">{data?.apiKey}</p>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(data?.apiKey || "");
                  toast("Api key copied to clipboard");
                }}
              >
                <CopyIcon className="size-4" />
              </button>
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
