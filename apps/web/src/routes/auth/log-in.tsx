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
import { Link } from "react-router-dom";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm, Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSignInMutation } from "@/network/mutations/useSignInMutation";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { toast } from "sonner";
import { useUserStore } from "@/store/userStore";

const formSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(2, {
      message: "Password must be at least 2 characters.",
    })
    .max(50),
});

export function LogIn() {
  const signInMutation = useSignInMutation();
  const { user } = useUserStore();

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    signInMutation.mutate(values);
  }

  return (
    <div className="h-[100dvh] w-full grid place-content-center px-4">
      <Card className="mx-auto w-full md:w-96">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>
            Enter your email below to login to your account
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
                        <Input placeholder="m@example.com" {...field} />
                      </FormControl>
                      {/* <FormDescription /> */}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="*******"
                          type="password"
                          {...field}
                        />
                      </FormControl>
                      {/* <FormDescription /> */}
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full">
                  {signInMutation.isPending ? <LoadingSpinner /> : "Login"}
                </Button>
              </form>
              <Link
                to="/auth/forgot-password"
                className="mt-1 text-center inline-block text-sm underline"
              >
                Forgot your password?
              </Link>
            </Form>

            {/* <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                authenticationStore.setIsAuthenticated(true);
              }}
            >
              Login with Google
            </Button> */}
          </div>
          <div className="mt-4 text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link to="/auth/create-account" className="underline">
              Create one
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
