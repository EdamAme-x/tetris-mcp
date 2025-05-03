import { Hono } from "hono";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import puppeteer from "puppeteer";

async function createBrowser() {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-gpu",
    ],
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

const isEmpty = (style: string) => {
  return style.includes("#000000");
};

const getMailBoard = async () => {
  return (await page.$$("#fld")).slice(30).slice(0, 200);
};

const getServer = async () => {
  const server = new McpServer({
    name: "tetris-mcp-server-jp",
    version: "1.0.0",
  });

  server.tool("clearCurrentBoard", "現在の盤面をクリアします。", async () => {
    const board = await getMailBoard();

    for (let i = 0; i < board.length; i++) {
      const cell = await board[i];
      if (!cell)
        return {
          content: [
            {
              type: "text",
              text: "クリアに失敗しました。(Cell not found)",
            },
          ],
        };

      if (!isEmpty(await cell.evaluate((node) => node.getAttribute("style")))) {
        await cell.click();
        if  (!isEmpty(await cell.evaluate((node) => node.getAttribute("style")))) {
            await cell.click();
        }
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
      const mapping = [
        ["#000000", "_"],
        ["rgb(153, 153, 153)", "X"],
        ["rgb(153, 102, 0)", "L"],
        ["rgb(0, 0, 187)", "J"],
        ["rgb(0, 153, 0)", "S"],
        ["rgb(153, 0, 0)", "Z"],
        ["rgb(0, 153, 153)", "I"],
        ["rgb(153, 153, 0)", "O"],
        ["rgb(153, 0, 153)", "T"],
      ];

      const board = await getMailBoard();

      let result: string[][] = [];
      let p = 0;
      const separator = 10;

      for (let i = 0; i < board.length; i++) {
        const cell = await board[i];
        if (!cell)
          return {
            content: [
              {
                type: "text",
                text: "取得に失敗しました。(Cell not found)",
              },
            ],
          };

        const style = await cell.evaluate((node) => node.getAttribute("style"));
        const color = mapping.find((m) => style.includes(m[0]))?.[1];
        if (!color)
          return {
            content: [
              {
                type: "text",
                text: "取得に失敗しました。(Color not found)",
              },
            ],
          };

        let line = result[Math.floor(p / separator)];

        if (!line) {
          result.push([]);
          line = result[result.length - 1];
        }

        line!.push(color);
        p++;
      }

      return {
        content: [
          {
            type: "text",
            text: "[" + result.map((row) => row.join(",")).join("],[") + "]",
          },
        ],
      };
    }
  );

  server.tool("getPageNumber", "現在の何ページ目かを取得します。", async () => {
    return  {
      content: [
        {
          type: "text",
          text: (await page.evaluate("frame + 1"))!.toString(),
        },
      ],
    }
  })

  server.tool("getPageCount", "現在の何ページあるかを取得します。", async () => {
    return  {
      content: [
        {
          type: "text",
          text: (await page.evaluate("pgnum"))!.toString(),
        },
      ],
    }
  })

  server.tool("removeAllNextPage", "次のページをすべて削除します。", async () => {
    await page.evaluate("delpage()");
    return  {
      content: [
        {
          type: "text",
          text: "次のページをすべて削除しました。",
        },
      ],
    }
  })

  server.tool("nextPage", "次のページに移動します。無い場合は作成します。", async () => {
    await page.evaluate("pgnext()");
    return  {
      content: [
        {
          type: "text",
          text: "次のページに移動しました。",
        },
      ],
    }
  })

  server.tool("previousPage", "前のページに移動します。", async () => {
    const  frame = await page.evaluate("frame");

    if (frame === 0) {
      return  {
        content: [
          {
            type: "text",
            text: "ここは一番最初のページです。",
          },
        ],
      }
    }

    await page.evaluate("pgprev()");
    return  {
      content: [
        {
          type: "text",
          text: "前のページに移動しました。",
        },
      ],
    }
  })

  server.tool("moveToPage", "指定したページに移動します。", {
    pageNumber: z.string().regex(/^[1-9][0-9]*$/),
  }, async ({ pageNumber }) => {
    await page.evaluate(`document.getElementById("pgnm").value = ${pageNumber}`);
    await page.evaluate(`pgset()`);
    return  {
      content: [
        {
          type: "text",
          text: `ページ${pageNumber}に移動しました。`,
        },
      ],
    }
  })

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

export default { fetch: app.fetch, port };
