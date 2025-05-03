import { Hono } from "hono";
import * as v from "valibot";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import puppeteer from 'puppeteer';

async function createBrowser() {
    const browser = await puppeteer.launch({
      headless: true,
      devtools: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process',
        '--single-process',
        '--no-zygote',
      ]
    });
    console.log('Browser launched');
    return browser
  }

const browser = await createBrowser();

const page = await browser.newPage();

const fumen = await page.goto('https://fumen.zui.jp/');

if (fumen?.ok)  {
  console.log('Fumen loaded');
} else {
  console.log('Fumen failed to load');
  await browser.close();
  process.exit(1);
}

await page.waitForSelector("#fld");

const isEmpty = (style: string) => {
  return style.includes("rgb(0, 0, 0)")
}

const getMailBoard = async ()  =>  {
    return [...await page.$$("#fld")].slice(30).slice(0,   200);
}

const getServer = async () => {
  const server = new McpServer({
    name: "tetris-mcp-server-jp",
    version: "1.0.0",
  });

  server.tool("clearCurrentBoard", "現在の盤面をクリアします。", async () => {
    const board = await getMailBoard();

    for (let i = 0; i < board.length; i++) {
      const cell = await board[i]
      if (!cell) return  {
        content: [
          {
            type: "text",
            text: "クリアに失敗しました。",
          },
        ],
      };

      if (!isEmpty(await cell.evaluate((node) => node.getAttribute("style")))) {
        await cell.click();
      }
    }

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
    "現在の盤面を取得します。アンダーバーは空白、Xはお邪魔ブロック(汎用ブロック)、それ以外のアルファベットは、ミノの名残を表します。例えば、ZはZミノの名残を表します。二次元配列で表現します。",
    async () => {
      return {
        content: [
          {
            type: "text",
            // [[_, _, Z, Z, _, _]]
            text: "",
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

  const server = await  getServer();

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

app.get("/mcp", (c) => {
  console.log("Received GET MCP request");
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

export { app, port };
