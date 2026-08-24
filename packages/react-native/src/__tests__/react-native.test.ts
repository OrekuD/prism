import { describe, it, expect, vi } from "vitest";
import { createReactNativeClient, resetReactNativeInstallForTests } from "../index";
vi.mock("react-native", ()=>({ AppState:{ addEventListener:()=>({ remove:()=>{} }) } }));
describe("react-native",()=>{
  it("creates client without throw", async()=>{
    resetReactNativeInstallForTests();
    globalThis.fetch = vi.fn(async()=>({ status:200, text: async()=>"{}", headers: new Map() } as any));
    const c=await createReactNativeClient({ sourceKey:"psk_test", endpoint:"https://example.com", collection:{initialState:"granted"}, storage:{getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}} as any });
    expect(c).toBeDefined();
    expect(typeof (c as any).track).toBe("function");
    await (c as any).shutdown?.();
  });
  it("screen controller queues screen view", async()=>{
    resetReactNativeInstallForTests();
    globalThis.fetch = vi.fn(async()=>({ status:200, text: async()=>"{}"} as any));
    const { createScreenController } = await import("../screen");
    const calls:any[]=[];
    const ctrl=createScreenController({ track:(n,p)=>calls.push([n,p]) } as any);
    ctrl.track("Home");
    expect(calls[0][0]).toBe("$prism_screen_view");
  });
});
