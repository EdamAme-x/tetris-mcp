import { Hono } from "hono";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import puppeteer from "puppeteer";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function createBrowser() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  console.log("Browser launched");
  return browser;
}

const browser = await createBrowser();

const page = await browser.newPage();

const fumen = await page.goto("https://fumen.zui.jp/");

if (fumen?.ok) {
  console.log("Fumen loaded");
} else {
  console.log("Fumen failed to load");
  await browser.close();
  process.exit(1);
}

await page.waitForSelector("#fld");
await page.evaluate("window.alert = () => {}");
await page.evaluate("window.confirm = () => true");

const getServer = async () => {
  const server = new McpServer({
    name: "tetris-mcp-server-jp",
    version: "1.0.0",
  });

  server.tool("clearCurrentBoard", "現在の盤面をクリアします。", async () => {
    await page.evaluate(`
        for (let i = 0; i < f.length; i++) {
            f[i] = 0;
        }
        
        pushframe(frame);
        updated();
        refresh();
    `);

    return {
      content: [
        {
          type: "text",
          text: "クリアしました。",
        },
      ],
    };
  });

  server.tool(
    "getCurrentBoard",
    "現在の盤面を取得します。アンダーバーは空白、Xはお邪魔ピクセル(汎用ピクセル)、それ以外のアルファベットは、ミノの名残を表します。例えば、ZはZミノの名残を表します。二次元配列で表現します。",
    async () => {
      const board = (await page.evaluate("f")) as number[];

      let result: string[] = board
        .slice(30)
        .slice(0, 200)
        .map((cell) => {
          switch (cell) {
            case 0:
              return "_";
            case 1:
              return "I";
            case 2:
              return "L";
            case 3:
              return "O";
            case 4:
              return "Z";
            case 5:
              return "T";
            case 6:
              return "J";
            case 7:
              return "S";
            case 8:
              return "X";
            default:
              return "?";
          }
        });

      return {
        content: [
          {
            type: "text",
            text:
              "[" +
              ((arr, size) =>
                arr.flatMap((_, i, a) =>
                  i % size ? [] : [a.slice(i, i + size)]
                ))(result, 10)
                .map((row) => row.join(","))
                .join("],[") +
              "]",
          },
        ],
      };
    }
  );

  server.tool(
    "getPageNumber",
    "現在の何ページ目かを取得します。",
    async () => {
      return {
        content: [
          {
            type: "text",
            text: (await page.evaluate("frame + 1"))!.toString(),
          },
        ],
      };
    }
  );

  server.tool(
    "getPageCount",
    "現在の何ページあるかを取得します。",
    async () => {
      return {
        content: [
          {
            type: "text",
            text: (await page.evaluate("pgnum"))!.toString(),
          },
        ],
      };
    }
  );

  server.tool(
    "removeAllNextPage",
    "次のページをすべて削除します。",
    async () => {
      await page.evaluate("delpage()");
      return {
        content: [
          {
            type: "text",
            text: "次のページをすべて削除しました。",
          },
        ],
      };
    }
  );

  server.tool(
    "nextPage",
    "次のページに移動します。無い場合は作成します。",
    async () => {
      await page.evaluate("pgnext()");
      return {
        content: [
          {
            type: "text",
            text: "次のページに移動しました。",
          },
        ],
      };
    }
  );

  server.tool("previousPage", "前のページに移動します。", async () => {
    const frame = await page.evaluate("frame");

    if (frame === 0) {
      return {
        content: [
          {
            type: "text",
            text: "ここは一番最初のページです。",
          },
        ],
      };
    }

    await page.evaluate("pgprev()");
    return {
      content: [
        {
          type: "text",
          text: "前のページに移動しました。",
        },
      ],
    };
  });

  server.tool(
    "moveToPage",
    "指定したページに移動します。",
    {
      pageNumber: z.string().regex(/^[1-9][0-9]*$/),
    },
    async ({ pageNumber }) => {
      await page.evaluate(
        `document.getElementById("pgnm").value = ${pageNumber}`
      );
      await page.evaluate(`pgset()`);
      return {
        content: [
          {
            type: "text",
            text: `ページ${pageNumber}に移動しました。`,
          },
        ],
      };
    }
  );

  server.tool("reset", "全てをリセットします。", async () => {
    await page.evaluate("newdata()");
    return {
      content: [
        {
          type: "text",
          text: "全てをリセットしました。",
        },
      ],
    };
  });

  server.tool("getViewUrl", "盤面閲覧用URLを発行します。", async () => {
    await page.evaluate("encode(1);");
    const url = await page.evaluate('document.querySelector("#tx").value');
    return {
      content: [
        {
          type: "text",
          text: "https://fumen.zui.jp/?" + String(url),
        },
      ],
    };
  });

  server.tool(
    "setColor",
    "盤面を塗る為の色を変更します。1~8の番号がそれぞれ、ILOZTJSXの色に相当します。1:I, 2:O, 3:L, 4:Z, 5:T, 6:J, 7:S, 8:X",
    {
      color: z.string().regex(/^[1-8]$/),
    },
    async ({ color }) => {
      await page.evaluate(`refresh();fe = ${color};`);
      return {
        content: [
          {
            type: "text",
            text: "色を変更しました。",
          },
        ],
      };
    }
  );

  server.tool(
    "drawPixel",
    "盤面にピクセルを描画します。X,Yは0から始まります。",
    {
      x: z.string().regex(/^[1-9]?[0-9]*$/),
      y: z.string().regex(/^[1-9]?[0-9]*$/),
    },
    async ({ x, y }) => {
      await page.evaluate(`f[${Number(y) * 10 + Number(x)}] = fe;
        pushframe(frame);
        updated();
        refresh();
    `);

      return {
        content: [
          {
            type: "text",
            text: "ピクセルを描画しました。",
          },
        ],
      };
    }
  );

  return server;
};

const app = new Hono();

app.post("/mcp", async (c) => {
  const { req, res } = toReqRes(c.req.raw);

  const server = await getServer();

  try {
    const body = await c.req.json();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    transport.onerror = console.error.bind(console);

    await server.connect(transport);

    await transport.handleRequest(req, res, body);

    res.on("close", () => {
      console.log("Request closed");
      transport.close();
      server.close();
    });

    console.log(res);

    return toFetchResponse(res);
  } catch (e) {
    console.error("MCP request error:", e);
    return c.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      },
      { status: 500 }
    );
  }
});

app.get("/mcp", async (c) => {
  const { req, res } = toReqRes(c.req.raw);

  const server = await getServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    transport.onerror = console.error.bind(console);

    await server.connect(transport);

    await transport.handleRequest(req, res);

    res.on("close", () => {
      console.log("Request closed");
      transport.close();
      server.close();
    });

    console.log(res);

    return toFetchResponse(res);
  } catch (e) {
    console.error("MCP request error:", e);
    return c.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      },
      { status: 500 }
    );
  }
});

app.delete("/mcp", (c) => {
  console.log("Received DELETE MCP request");
  return c.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    },
    { status: 405 }
  );
});

const port = 3000;
console.log(`Server is running on port ${port}`);

export default { fetch: app.fetch, port };
