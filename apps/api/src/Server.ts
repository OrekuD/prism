import { cors } from "hono/cors";
import { router as Router } from "./routers/Router";
import { HonoConfig } from "./types/types";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";

class Server {
  private instance: OpenAPIHono<HonoConfig>;

  constructor() {
    // this.instance = new Hono();
    this.instance = new OpenAPIHono();
  }

  public startServer() {
    this.instance.get("/", async (ctx) => {
      return ctx.text("Waguan");
    });
    this.instance.post("/test", async (ctx) => {
      const { results } = await ctx.env.DB.prepare(
        "SELECT * FROM sessions",
      ).all();

      let postsDocs: any = [];
      // await ctx.get('db').insert(posts).values({ text: 'example 2' }).returning().execute();

      // await ctx.get('client').connect();
      // postsDocs = await ctx.get('db').select().from(posts);

      // postsDocs = await DatabaseManager.getInstance(ctx)('SELECT * FROM posts WHERE text = $1', ['example']); // fastest on average
      // postsDocs = await DatabaseManager.getInstance(ctx)('SELECT * FROM posts'); // fastest on average
      // // postsDocs = await ctx.get('sql')('SELECT * FROM posts WHERE text = $1', ['example']); // second fastest on average
      // // postsDocs = await ctx.get('db').select().from(posts).where(eq(posts.text, 'example')); // slowest on average -> get client and connect before using this

      console.log({ posts: results });
      return ctx.json({ key: "worked", posts: results });
    });

    this.instance.use("/api/v1/*", cors());
    // this.instance.use("/api/v1", InjectDatabaseMiddleware);
    this.instance.route("/api/v1", Router);

    this.instance.get("/api/v1/docs", swaggerUI({ url: "/doc" }));
    this.instance.doc("/doc", {
      info: {
        title: "Prism API",
        version: "v1",
      },
      openapi: "3.1.0",
    });
  }

  public getInstance() {
    return this.instance;
  }
}

export default new Server();
