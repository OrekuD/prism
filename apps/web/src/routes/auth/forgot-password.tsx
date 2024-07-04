import React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForm } from "react-hook-form";
import {
  ForgotPasswordRequest,
  ForgotPasswordRequestSchema,
} from "@prism/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForgotPasswordMutation } from "@/network/mutations/useForgotPasswordMutation";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { CheckCircledIcon } from "@radix-ui/react-icons";

export function ForgotPassword() {
  const forgotPasswordMutation = useForgotPasswordMutation();

  const form = useForm({
    resolver: zodResolver(ForgotPasswordRequestSchema),
    defaultValues: {
      email: "",
    },
  });

  function onSubmit(values: ForgotPasswordRequest) {
    forgotPasswordMutation.mutate(values);
  }

  return (
    <div className="h-[100dvh] w-full grid place-content-center px-4">
      {forgotPasswordMutation.isSuccess ? (
        <Card className="mx-auto w-full text-center md:w-96">
          <CardHeader className="grid place-items-center">
            <CheckCircledIcon className="size-10" />
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              Instructions have been sent to reset your password.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="mx-auto w-full md:w-96">
          <CardHeader>
            <CardTitle className="text-2xl">Forgot Password</CardTitle>
            <CardDescription>
              Enter the email address associated with your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="m@example.com"
                            type="email"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={forgotPasswordMutation.isPending}
                  >
                    {forgotPasswordMutation.isPending ? (
                      <LoadingSpinner />
                    ) : (
                      "Submit"
                    )}
                  </Button>
                </form>
              </Form>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
