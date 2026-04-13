export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    function isLoggedIn(request) {
      const cookie = request.headers.get("Cookie") || "";
      return cookie.includes("session=");
    }

    // 根路径跳转（修复 Error 1101）
    if (url.pathname === "/") {
      const target = isLoggedIn(request) ? "/admin" : "/login";
      const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>跳转中...</title>
<script>
  window.location.href = "${target}";
</script>
</head>
<body>正在跳转...</body>
</html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // 退出登录
    if (url.pathname === "/logout") {
      return new Response("退出成功", {
        status: 303,
        headers: {
          "Set-Cookie": "session=; Path=/; HttpOnly; Max-Age=0",
          "Location": "/login"
        }
      });
    }

    // 登录页
    if (url.pathname === "/login") {
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>喵提醒管理后台登录</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 flex items-center justify-center min-h-screen p-4">
  <div class="bg-white shadow-lg rounded-xl p-8 w-full max-w-sm">
    <h2 class="text-2xl font-bold mb-6 text-center">喵提醒管理后台登录</h2>

    <input id="pwd" type="password"
      class="w-full border rounded-lg px-4 py-2 mb-4 focus:ring focus:ring-blue-200"
      placeholder="请输入密码">

    <button onclick="login()"
      class="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition">
      登录
    </button>

    <script>
      async function login() {
        const password = document.getElementById("pwd").value;

        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });

        const data = await res.json();
        if (data.ok) location.href = "/admin";
        else alert("密码错误");
      }
    </script>
  </div>
</body>
</html>
      `;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // 后台首页：兼容旧任务 + 新任务（多 Cron）
    if (url.pathname === "/admin") {
      if (!isLoggedIn(request)) {
        const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>跳转中...</title>
<script>window.location.href="/login";</script>
</head>
<body>正在跳转...</body>
</html>`;
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }

      const tasks = await env.DB.prepare(`
        SELECT t.*,
          (SELECT COUNT(*) FROM task_items ti WHERE ti.task_id = t.id) AS item_count
        FROM tasks t
        ORDER BY id DESC
      `).all();

      // 最近日志（旧任务）
      const oldLastLogs = await env.DB.prepare(`
        SELECT tl.*
        FROM task_logs tl
        WHERE tl.task_id > 0
        ORDER BY tl.id DESC
        LIMIT 200
      `).all();
      const oldLastMap = new Map();
      for (const l of oldLastLogs.results) {
        if (!oldLastMap.has(l.task_id)) oldLastMap.set(l.task_id, l);
      }

      // 最近日志（新任务）
      const newLastLogs = await env.DB.prepare(`
        SELECT tl.*
        FROM task_logs tl
        WHERE tl.task_id < 0
        ORDER BY tl.id DESC
        LIMIT 200
      `).all();
      const itemLastMap = new Map();
      for (const l of newLastLogs.results) {
        if (!itemLastMap.has(l.task_id)) itemLastMap.set(l.task_id, l);
      }

      const listHtml = await Promise.all(tasks.results.map(async t => {
        let lastStatus = null;
        let lastCode = null;
        let lastTime = null;

        // 旧任务日志
        const oldLog = oldLastMap.get(t.id);
        if (oldLog) {
          lastStatus = oldLog.status;
          lastCode = oldLog.http_code;
          lastTime = oldLog.run_time;
        }

        // 新任务日志
        if (t.item_count > 0) {
          const items = await env.DB.prepare(
            "SELECT id FROM task_items WHERE task_id = ?"
          ).bind(t.id).all();

          let bestLog = null;
          for (const it of items.results) {
            const log = itemLastMap.get(-it.id);
            if (log) {
              if (!bestLog || log.id > bestLog.id) bestLog = log;
            }
          }
          if (bestLog) {
            lastStatus = bestLog.status;
            lastCode = bestLog.http_code;
            lastTime = bestLog.run_time;
          }
        }

        const title = t.remark ? t.remark : ("任务 #" + t.id);

        const secondLine = t.item_count > 0
          ? ("时间规则数量: " + t.item_count)
          : ("cron: " + (t.cron || "-"));

        const thirdLine = t.item_count > 0
          ? ("URL: " + (t.url || "-") + "（多时间规则任务）")
          : ("URL: " + (t.url || "-"));

        return `
        <div class="border rounded-lg p-4 hover:bg-gray-50 transition">
          <div class="font-semibold text-lg break-all">${title}</div>
          <div class="text-sm text-gray-600">${secondLine}</div>
          <div class="text-sm text-gray-600">${thirdLine}</div>
          <div class="text-sm text-gray-600">状态: ${t.enabled ? "启用" : "禁用"}</div>
          <div class="text-sm text-gray-600">
            上次执行: ${
              lastTime
                ? `${lastStatus ? "成功" : "失败"} (${lastCode || "-"}) ${lastTime}`
                : "无记录"
            }
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <button onclick="location.href='/admin/edit?id=${t.id}'"
              class="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">编辑</button>

            <button onclick="location.href='/api/tasks/delete?id=${t.id}'"
              class="px-3 py-1 bg-red-200 text-red-700 rounded hover:bg-red-300">删除</button>


            <button onclick="location.href='/api/tasks/toggle?id=${t.id}'"
              class="px-3 py-1 bg-yellow-200 text-yellow-700 rounded hover:bg-yellow-300">
              ${t.enabled ? "禁用" : "启用"}
            </button>

            <button onclick="location.href='/admin/logs?id=${t.id}'"
              class="px-3 py-1 bg-blue-200 text-blue-700 rounded hover:bg-blue-300">日志</button>

            <button onclick="location.href='/admin/logs/stats?id=${t.id}'"
              class="px-3 py-1 bg-green-200 text-green-700 rounded hover:bg-green-300">统计</button>
          </div>
        </div>
        `;
      }));

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>喵提醒自动化任务</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 text-gray-800">
  <div class="max-w-5xl mx-auto py-6 px-4">

    <div class="flex justify-between items-center mb-8">
      <h2 class="text-3xl font-bold">喵提醒自动化任务</h2>

      <div class="flex gap-2">
        <button onclick="location.href='/admin/new'"
          class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
          新增任务
        </button>

        <button onclick="location.href='/logout'"
          class="bg-gray-300 px-4 py-2 rounded-lg hover:bg-gray-400 transition">
          退出登录
        </button>
      </div>
    </div>

    <div class="bg-white shadow rounded-xl p-6">
      <h3 class="text-xl font-semibold mb-4">任务列表</h3>

      <div class="space-y-4">
        ${listHtml.join("")}
      </div>
    </div>

  </div>
</body>
</html>
      `;

      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // 新增任务页面：一个 URL + 多条 Cron + 共用时区
    if (url.pathname === "/admin/new") {
      if (!isLoggedIn(request)) {
        const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><script>window.location.href="/login";</script></head>
<body>正在跳转...</body></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>新增任务 - 喵提醒自动化任务</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 text-gray-800">
  <div class="max-w-xl mx-auto py-10 px-4">

    <h2 class="text-3xl font-bold mb-6">新增任务</h2>

    <div class="bg-white shadow rounded-xl p-6 space-y-4">

      <div>
        <label class="block mb-1 font-medium">任务备注</label>
        <input id="remark" class="w-full border rounded-lg px-4 py-2" placeholder="例如：工作日早上检查服务" />
      </div>

      <div>
        <label class="block mb-1 font-medium">提醒 URL（唯一）</label>
        <input id="url" class="w-full border rounded-lg px-4 py-2" placeholder="https://example.com/check" />
      </div>

      <div>
        <label class="block mb-1 font-medium">时区（所有时间规则共用）</label>
        <select id="timezone" class="w-full border rounded-lg px-4 py-2">
          <option value="8">UTC+8 北京时间（默认）</option>
          <option value="0">UTC+0</option>
          <option value="1">UTC+1</option>
          <option value="2">UTC+2</option>
          <option value="3">UTC+3</option>
          <option value="4">UTC+4</option>
          <option value="5">UTC+5</option>
          <option value="6">UTC+6</option>
          <option value="7">UTC+7</option>
          <option value="9">UTC+9</option>
          <option value="10">UTC+10</option>
          <option value="11">UTC+11</option>
          <option value="12">UTC+12</option>
        </select>
      </div>

      <div>
        <label class="block mb-1 font-medium">时间规则（Cron，按所选时区填写，可添加多条）</label>
        <p class="text-xs text-gray-500 mb-1">例如：0 8 * * 1 表示每周一 08:00（本地时区）</p>
        <div id="cronList" class="space-y-2"></div>
        <button id="addCron"
          class="mt-2 px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-sm">
          添加一条时间规则
        </button>
        <p id="cronError" class="text-red-600 text-sm mt-1 hidden"></p>
      </div>

      <button onclick="submitForm()"
        class="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition">
        保存
      </button>

      <button onclick="location.href='/admin'"
        class="w-full bg-gray-200 py-2 rounded-lg hover:bg-gray-300 transition mt-2">
        返回
      </button>

    </div>

    <script>
      function addCronRow(value) {
        const list = document.getElementById("cronList");
        const div = document.createElement("div");
        div.className = "flex gap-2";
        div.innerHTML = \`
          <input class="flex-1 border rounded-lg px-4 py-2 cron-input" placeholder="例如：0 8 * * 1" value="\${value || ""}">
          <button type="button" class="px-3 py-1 bg-red-200 text-red-700 rounded remove-cron">删除</button>
        \`;
        list.appendChild(div);

        div.querySelector(".remove-cron").addEventListener("click", () => {
          const all = document.querySelectorAll("#cronList .cron-input");
          if (all.length <= 1) {
            alert("至少保留一条时间规则");
            return;
          }
          div.remove();
        });
      }

      document.getElementById("addCron").addEventListener("click", () => addCronRow());
      addCronRow(); // 初始化至少一条

      function validateCron(cron) {
        const parts = cron.trim().split(/\\s+/);
        if (parts.length !== 5) return "Cron 必须包含 5 段";
        for (let i = 0; i < 5; i++) {
          const p = parts[i];
          if (!/(^\\*$)|(^\\d+$)|(^\\d+-\\d+$)|(^\\*\\/\\d+$)|(^\\d+(,\\d+)*$)/.test(p)) {
            return "第 " + (i + 1) + " 段格式不正确";
          }
        }
        return null;
      }

      function shiftCronByOffset(cron, offsetHours) {
        const parts = cron.trim().split(/\\s+/);
        if (parts.length !== 5) return cron;
        let [m, h, d, mo, w] = parts;
        if (/^\\d+$/.test(h)) {
          let hour = parseInt(h, 10) - offsetHours;
          while (hour < 0) hour += 24;
          while (hour >= 24) hour -= 24;
          h = String(hour);
        }
        return [m, h, d, mo, w].join(" ");
      }

      async function submitForm() {
        const remark = document.getElementById("remark").value.trim();
        const url = document.getElementById("url").value.trim();
        const offset = parseInt(document.getElementById("timezone").value, 10);

        if (!url) {
          alert("请填写提醒 URL");
          return;
        }

        const cronInputs = Array.from(document.querySelectorAll(".cron-input"));
        const localCrons = cronInputs.map(i => i.value.trim()).filter(v => v);
        if (localCrons.length === 0) {
          alert("至少填写一条时间规则");
          return;
        }

        const utcCrons = [];
        for (const c of localCrons) {
          const err = validateCron(c);
          if (err) {
            const el = document.getElementById("cronError");
            el.innerText = "错误的 Cron：" + c + "，" + err;
            el.classList.remove("hidden");
            return;
          }
          utcCrons.push(shiftCronByOffset(c, offset));
        }

        const res = await fetch("/api/tasks/create-multi-cron", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            remark,
            url,
            crons: utcCrons,
            timezone_offset: offset
          })
        });

        const data = await res.json();
        if (data.ok) location.href = "/admin";
        else alert("保存失败");
      }

      window.submitForm = submitForm;
    </script>

  </div>
</body>
</html>
      `;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // 编辑任务页面：旧任务可编辑 URL+cron，新任务可编辑 URL+多 Cron+时区
    if (url.pathname === "/admin/edit") {
      if (!isLoggedIn(request)) {
        const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><script>window.location.href="/login";</script></head>
<body>正在跳转...</body></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }

      const id = url.searchParams.get("id");
      const task = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
      if (!task) return new Response("任务不存在");

      const items = await env.DB.prepare(
        "SELECT * FROM task_items WHERE task_id = ? ORDER BY id ASC"
      ).bind(id).all();

      const isNewStyle = items.results.length > 0;
      const timezoneOffset = isNewStyle
        ? (items.results[0]?.timezone_offset ?? 8)
        : 8;

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>编辑任务 - 喵提醒自动化任务</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 text-gray-800">
  <div class="max-w-xl mx-auto py-10 px-4">

    <h2 class="text-3xl font-bold mb-6">编辑任务 #${task.id}</h2>

    <div class="bg-white shadow rounded-xl p-6 space-y-4">

      <div>
        <label class="block mb-1 font-medium">任务备注</label>
        <input id="remark" class="w-full border rounded-lg px-4 py-2" value="${task.remark || ""}" />
      </div>

      <div>
        <label class="block mb-1 font-medium">提醒 URL（唯一）</label>
        <input id="url" class="w-full border rounded-lg px-4 py-2" value="${task.url || ""}" />
      </div>

      ${isNewStyle ? `
      <div>
        <label class="block mb-1 font-medium">时区（所有时间规则共用）</label>
        <select id="timezone" class="w-full border rounded-lg px-4 py-2">
          <option value="8" ${timezoneOffset === 8 ? "selected" : ""}>UTC+8 北京时间</option>
          <option value="0" ${timezoneOffset === 0 ? "selected" : ""}>UTC+0</option>
          <option value="1" ${timezoneOffset === 1 ? "selected" : ""}>UTC+1</option>
          <option value="2" ${timezoneOffset === 2 ? "selected" : ""}>UTC+2</option>
          <option value="3" ${timezoneOffset === 3 ? "selected" : ""}>UTC+3</option>
          <option value="4" ${timezoneOffset === 4 ? "selected" : ""}>UTC+4</option>
          <option value="5" ${timezoneOffset === 5 ? "selected" : ""}>UTC+5</option>
          <option value="6" ${timezoneOffset === 6 ? "selected" : ""}>UTC+6</option>
          <option value="7" ${timezoneOffset === 7 ? "selected" : ""}>UTC+7</option>
          <option value="9" ${timezoneOffset === 9 ? "selected" : ""}>UTC+9</option>
          <option value="10" ${timezoneOffset === 10 ? "selected" : ""}>UTC+10</option>
          <option value="11" ${timezoneOffset === 11 ? "selected" : ""}>UTC+11</option>
          <option value="12" ${timezoneOffset === 12 ? "selected" : ""}>UTC+12</option>
        </select>
      </div>

      <div>
        <label class="block mb-1 font-medium">时间规则（Cron，按所选时区填写，可添加多条）</label>
        <div id="cronList" class="space-y-2"></div>
        <button id="addCron"
          class="mt-2 px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 text-sm">
          添加一条时间规则
        </button>
        <p id="cronError" class="text-red-600 text-sm mt-1 hidden"></p>
      </div>
      ` : `
      <div class="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
        该任务为“旧结构任务”，使用单一 Cron。  
        你可以继续编辑 URL 和 Cron，或删除后使用“新增任务”创建多时间规则任务。
      </div>

      <div>
        <label class="block mb-1 font-medium">Cron 表达式（UTC）</label>
        <input id="cron" class="w-full border rounded-lg px-4 py-2" value="${task.cron || ""}" />
        <p id="cronError" class="text-red-600 text-sm mt-1 hidden"></p>
      </div>
      `}

      <button onclick="submitForm()"
        class="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition">
        保存
      </button>

      <button onclick="location.href='/admin'"
        class="w-full bg-gray-200 py-2 rounded-lg hover:bg-gray-300 transition mt-2">
        返回
      </button>

    </div>

    <script>
      const isNewStyle = ${isNewStyle ? "true" : "false"};
      const existingItems = ${JSON.stringify(items.results || [])};

      function validateCron(cron) {
        const parts = cron.trim().split(/\\s+/);
        if (parts.length !== 5) return "Cron 必须包含 5 段";
        for (let i = 0; i < 5; i++) {
          const p = parts[i];
          if (!/(^\\*$)|(^\\d+$)|(^\\d+-\\d+$)|(^\\*\\/\\d+$)|(^\\d+(,\\d+)*$)/.test(p)) {
            return "第 " + (i + 1) + " 段格式不正确";
          }
        }
        return null;
      }

      function shiftCronByOffset(cron, offsetHours) {
        const parts = cron.trim().split(/\\s+/);
        if (parts.length !== 5) return cron;
        let [m, h, d, mo, w] = parts;
        if (/^\\d+$/.test(h)) {
          let hour = parseInt(h, 10) - offsetHours;
          while (hour < 0) hour += 24;
          while (hour >= 24) hour -= 24;
          h = String(hour);
        }
        return [m, h, d, mo, w].join(" ");
      }

      function addCronRow(value) {
        const list = document.getElementById("cronList");
        const div = document.createElement("div");
        div.className = "flex gap-2";
        div.innerHTML = \`
          <input class="flex-1 border rounded-lg px-4 py-2 cron-input" placeholder="例如：0 8 * * 1" value="\${value || ""}">
          <button type="button" class="px-3 py-1 bg-red-200 text-red-700 rounded remove-cron">删除</button>
        \`;
        list.appendChild(div);

        div.querySelector(".remove-cron").addEventListener("click", () => {
          const all = document.querySelectorAll("#cronList .cron-input");
          if (all.length <= 1) {
            alert("至少保留一条时间规则");
            return;
          }
          div.remove();
        });
      }

      if (isNewStyle) {
        const list = document.getElementById("cronList");
        if (existingItems.length > 0) {
          existingItems.forEach(it => addCronRow(it.cron));
        } else {
          addCronRow();
        }
        document.getElementById("addCron").addEventListener("click", () => addCronRow());
      }

      async function submitForm() {
        const remark = document.getElementById("remark").value.trim();
        const url = document.getElementById("url").value.trim();

        if (!url) {
          alert("请填写提醒 URL");
          return;
        }

        if (isNewStyle) {
          const offset = parseInt(document.getElementById("timezone").value, 10);
          const cronInputs = Array.from(document.querySelectorAll(".cron-input"));
          const localCrons = cronInputs.map(i => i.value.trim()).filter(v => v);
          if (localCrons.length === 0) {
            alert("至少填写一条时间规则");
            return;
          }

          const utcCrons = [];
          for (const c of localCrons) {
            const err = validateCron(c);
            if (err) {
              const el = document.getElementById("cronError");
              el.innerText = "错误的 Cron：" + c + "，" + err;
              el.classList.remove("hidden");
              return;
            }
            utcCrons.push(shiftCronByOffset(c, offset));
          }

          const res = await fetch("/api/tasks/update-multi-cron", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: ${task.id},
              remark,
              url,
              crons: utcCrons,
              timezone_offset: offset
            })
          });
          const data = await res.json();
          if (data.ok) location.href = "/admin";
          else alert("保存失败");
        } else {
          const cron = document.getElementById("cron").value.trim();
          const err = validateCron(cron);
          if (err) {
            const el = document.getElementById("cronError");
            el.innerText = err;
            el.classList.remove("hidden");
            return;
          }

          const res = await fetch("/api/tasks/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: ${task.id},
              remark,
              url,
              cron
            })
          });
          const data = await res.json();
          if (data.ok) location.href = "/admin";
          else alert("保存失败");
        }
      }

      window.submitForm = submitForm;
    </script>

  </div>
</body>
</html>
      `;

      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // 日志列表（兼容：正 task_id = 旧任务；负 task_id = 新任务子 Cron）
    if (url.pathname === "/admin/logs") {
      if (!isLoggedIn(request)) {
        const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"><script>window.location.href="/login";</script></head>
<body>正在跳转...</body></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }

      const id = parseInt(url.searchParams.get("id"), 10);
      const page = parseInt(url.searchParams.get("page") || "1");
      const pageSize = 20;
      const offset = (page - 1) * pageSize;

      const logs = await env.DB.prepare(`
        SELECT * FROM task_logs 
        WHERE task_id = ? OR task_id IN (
          SELECT -ti.id FROM task_items ti WHERE ti.task_id = ?
        )
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
      `).bind(id, id, pageSize, offset).all();

      const rows = logs.results.map(l => `
        <tr class="border-b">
          <td class="px-4 py-2 whitespace-nowrap">
            <span class="time" data-time="${l.run_time}"></span>
          </td>
          <td class="px-4 py-2">${l.status ? "成功" : "失败"}</td>
          <td class="px-4 py-2">${l.http_code || "-"}</td>
          <td class="px-4 py-2">${l.duration_ms}ms</td>
          <td class="px-4 py-2 text-gray-600">
            ${l.task_id < 0 ? "时间规则 #" + (-l.task_id) : "旧任务 #" + l.task_id}
          </td>
          <td class="px-4 py-2 text-red-600 break-all">${l.error || ""}</td>
        </tr>
      `).join("");

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>任务日志 - 喵提醒自动化任务</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 text-gray-800">
  <div class="max-w-5xl mx-auto py-10 px-4">

    <h2 class="text-3xl font-bold mb-6">任务 #${id} 执行日志</h2>

    <div class="bg-white shadow rounded-xl p-6 overflow-x-auto">

      <table class="w-full text-left border-collapse min-w-max">
        <thead>
          <tr class="border-b bg-gray-50">
            <th class="px-4 py-2">执行时间（本地）</th>
            <th class="px-4 py-2">结果</th>
            <th class="px-4 py-2">状态码</th>
            <th class="px-4 py-2">耗时</th>
            <th class="px-4 py-2">来源</th>
            <th class="px-4 py-2">错误</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>

      <div class="flex justify-between mt-6">
        <button onclick="location.href='?id=${id}&page=${page - 1}'"
          class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          ${page <= 1 ? "disabled" : ""}>
          上一页
        </button>

        <button onclick="location.href='?id=${id}&page=${page + 1}'"
          class="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
          下一页
        </button>
      </div>

      <button onclick="location.href='/admin'"
        class="mt-6 w-full bg-gray-200 py-2 rounded-lg hover:bg-gray-300 transition">
        返回
      </button>

    </div>

    <script>
      document.querySelectorAll(".time").forEach(el => {
        const t = el.getAttribute("data-time");
        if (t) {
          el.textContent = new Date(t).toLocaleString();
        }
      });
    </script>

  </div>
</body>
</html>
      `;

      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // 统计图
    if (url.pathname === "/admin/logs/stats") {
      if (!isLoggedIn(request)) {
        const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"><script>window.location.href="/login";</script></head>
<body>正在跳转...</body></html>`;
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      }

      const id = parseInt(url.searchParams.get("id"), 10);

      const logs = await env.DB.prepare(`
        SELECT * FROM task_logs 
        WHERE task_id = ? OR task_id IN (
          SELECT -ti.id FROM task_items ti WHERE ti.task_id = ?
        )
        ORDER BY id ASC LIMIT 200
      `).bind(id, id).all();

      const data = logs.results.map((l, i) => ({
        index: i,
        duration: l.duration_ms,
        time: l.run_time
      }));

      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>任务统计 - 喵提醒自动化任务</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    #chart { border: 1px solid #ccc; }
  </style>
</head>
<body class="bg-gray-100 text-gray-800">
  <div class="max-w-5xl mx-auto py-10 px-4">

    <h2 class="text-3xl font-bold mb-6">任务 #${id} 执行统计图</h2>

    <canvas id="chart" width="900" height="400" class="w-full"></canvas>

    <script>
      const data = ${JSON.stringify(data)};

      const canvas = document.getElementById("chart");
      const ctx = canvas.getContext("2d");

      const padding = 50;
      const width = canvas.width - padding * 2;
      const height = canvas.height - padding * 2;

      const maxY = Math.max(...data.map(d => d.duration), 100);

      function x(i) {
        return padding + (i / Math.max(data.length - 1, 1)) * width;
      }
      function y(v) {
        return padding + height - (v / maxY) * height;
      }

      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(padding, padding);
      ctx.lineTo(padding, padding + height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(padding, padding + height);
      ctx.lineTo(padding + width, padding + height);
      ctx.stroke();

      ctx.fillStyle = "#000";
      ctx.font = "12px sans-serif";
      for (let i = 0; i <= 5; i++) {
        const v = (maxY / 5) * i;
        const yy = y(v);
        ctx.fillText(Math.round(v) + "ms", 5, yy + 4);

        ctx.strokeStyle = "#eee";
        ctx.beginPath();
        ctx.moveTo(padding, yy);
        ctx.lineTo(padding + width, yy);
        ctx.stroke();
      }

      for (let i = 0; i < data.length; i += Math.ceil(data.length / 10) || 1) {
        const xx = x(i);
        ctx.fillText(i, xx - 5, padding + height + 15);

        ctx.strokeStyle = "#eee";
        ctx.beginPath();
        ctx.moveTo(xx, padding);
        ctx.lineTo(xx, padding + height);
        ctx.stroke();
      }

      ctx.strokeStyle = "blue";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (data.length > 0) {
        ctx.moveTo(x(0), y(data[0].duration));
        for (let i = 1; i < data.length; i++) {
          ctx.lineTo(x(i), y(data[i].duration));
        }
        ctx.stroke();
      }
    </script>

    <button onclick="location.href='/admin/logs?id=${id}'"
      class="mt-6 w-full bg-blue-200 py-2 rounded-lg hover:bg-blue-300 transition">
      查看日志
    </button>

    <button onclick="location.href='/admin'"
      class="mt-3 w-full bg-gray-200 py-2 rounded-lg hover:bg-gray-300 transition">
      返回
    </button>

  </div>
</body>
</html>
      `;

      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // 创建新任务（一个 URL + 多 Cron）
    if (url.pathname === "/api/tasks/create-multi-cron" && request.method === "POST") {
      if (!isLoggedIn(request)) return new Response("Unauthorized", { status: 401 });

      const { remark, url: taskUrl, crons, timezone_offset } = await request.json();

      const result = await env.DB.prepare(
        "INSERT INTO tasks (url, cron, remark, enabled) VALUES (?, ?, ?, ?)"
      ).bind(taskUrl, "", remark || "", 1).run();

      const taskId = result.meta.last_row_id;

      for (const c of crons) {
        if (!c) continue;
        await env.DB.prepare(
          "INSERT INTO task_items (task_id, cron, timezone_offset) VALUES (?, ?, ?)"
        ).bind(taskId, c, timezone_offset).run();
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 更新新任务（一个 URL + 多 Cron）
    if (url.pathname === "/api/tasks/update-multi-cron" && request.method === "POST") {
      if (!isLoggedIn(request)) return new Response("Unauthorized", { status: 401 });

      const { id, remark, url: taskUrl, crons, timezone_offset } = await request.json();

      await env.DB.prepare(
        "UPDATE tasks SET url = ?, remark = ? WHERE id = ?"
      ).bind(taskUrl, remark || "", id).run();

      await env.DB.prepare(
        "DELETE FROM task_items WHERE task_id = ?"
      ).bind(id).run();

      for (const c of crons) {
        if (!c) continue;
        await env.DB.prepare(
          "INSERT INTO task_items (task_id, cron, timezone_offset) VALUES (?, ?, ?)"
        ).bind(id, c, timezone_offset).run();
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 创建旧任务 API（保留兼容）
    if (url.pathname === "/api/tasks/create" && request.method === "POST") {
      if (!isLoggedIn(request)) return new Response("Unauthorized", { status: 401 });

      const { url: taskUrl, cron, remark } = await request.json();

      await env.DB.prepare(
        "INSERT INTO tasks (url, cron, remark, enabled) VALUES (?, ?, ?, 1)"
      ).bind(taskUrl, cron, remark).run();

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 更新旧任务 API
    if (url.pathname === "/api/tasks/update" && request.method === "POST") {
      if (!isLoggedIn(request)) return new Response("Unauthorized", { status: 401 });

      const { id, url: taskUrl, cron, remark } = await request.json();

      await env.DB.prepare(
        "UPDATE tasks SET url = ?, cron = ?, remark = ? WHERE id = ?"
      ).bind(taskUrl, cron, remark, id).run();

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // 删除任务 API（删除父任务 + 子 Cron + 日志），用 HTML+JS 跳转避免 1101
    if (url.pathname === "/api/tasks/delete") {
      if (!isLoggedIn(request)) return new Response("Unauthorized", { status: 401 });

      const id = url.searchParams.get("id");

      // 删除子 Cron 日志
      const items = await env.DB.prepare(
        "SELECT id FROM task_items WHERE task_id = ?"
      ).bind(id).all();

      for (const it of items.results) {
        await env.DB.prepare(
          "DELETE FROM task_logs WHERE task_id = ?"
        ).bind(-it.id).run();
      }

      // 删除旧任务日志
      await env.DB.prepare(
        "DELETE FROM task_logs WHERE task_id = ?"
      ).bind(id).run();

      // 删除子 Cron
      await env.DB.prepare("DELETE FROM task_items WHERE task_id = ?")
        .bind(id)
        .run();

      // 删除父任务
      await env.DB.prepare("DELETE FROM tasks WHERE id = ?")
        .bind(id)
        .run();

      const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>删除成功</title>
<script>
  window.location.href = "/admin";
</script>
</head>
<body>
正在跳转...
</body>
</html>
      `;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // 启用/禁用任务 API（修复 Error 1101）
    if (url.pathname === "/api/tasks/toggle") {
      if (!isLoggedIn(request)) return new Response("Unauthorized", { status: 401 });

      const id = url.searchParams.get("id");

      const task = await env.DB.prepare("SELECT enabled FROM tasks WHERE id = ?")
        .bind(id)
        .first();

      const newStatus = task.enabled ? 0 : 1;

      await env.DB.prepare("UPDATE tasks SET enabled = ? WHERE id = ?")
        .bind(newStatus, id)
        .run();

      const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>跳转中...</title>
<script>
  window.location.href = "/admin";
</script>
</head>
<body>正在跳转...</body>
</html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // 登录 API
    if (url.pathname === "/api/login" && request.method === "POST") {
      const { password } = await request.json();

      if (password === env.ADMIN_PASSWORD) {
        const token = crypto.randomUUID();

        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`
          }
        });
      }

      return new Response(JSON.stringify({ ok: false }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 测试数据库 API
    if (url.pathname === "/api/test") {
      const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM tasks").first();
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Worker is running");
  },

  // ============================
  // scheduled 定时执行器
  // ============================
  async scheduled(event, env, ctx) {
    const now = new Date();

    // 1. 旧任务（兼容）
    const oldTasks = await env.DB.prepare(
      "SELECT * FROM tasks WHERE enabled = 1 AND url != '' AND cron != ''"
    ).all();

    for (const task of oldTasks.results) {
      if (shouldRunCron(task.cron, now)) {
        await runOne(env, task.url, now, task.id, true);
      }
    }

    // 2. 新任务（多 Cron）
    const items = await env.DB.prepare(`
      SELECT ti.*, t.url, t.enabled AS task_enabled
      FROM task_items ti
      JOIN tasks t ON ti.task_id = t.id
      WHERE t.enabled = 1 AND t.url != ''
    `).all();

    for (const item of items.results) {
      if (shouldRunCron(item.cron, now)) {
        await runOne(env, item.url, now, -item.id, false);
      }
    }
  }
};

// ============================
// 执行单个任务
// ============================
async function runOne(env, url, now, logTaskId, isOld) {
  const start = Date.now();
  let status = 1;
  let httpCode = null;
  let error = null;

  try {
    const res = await fetch(url);
    httpCode = res.status;
  } catch (e) {
    status = 0;
    error = String(e);
  }

  const duration = Date.now() - start;

  await env.DB.prepare(`
    INSERT INTO task_logs (task_id, run_time, status, http_code, duration_ms, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    logTaskId,
    now.toISOString(),
    status,
    httpCode,
    duration,
    error
  ).run();

  // 旧任务更新 last_run
  if (isOld) {
    await env.DB.prepare(
      "UPDATE tasks SET last_run = ? WHERE id = ?"
    ).bind(now.toISOString(), logTaskId).run();
  }
}

// ============================
// Cron 解析器
// ============================
function parseField(field, min, max) {
  if (field === "*") return null;

  const result = new Set();

  field.split(",").forEach(part => {
    if (part.includes("/")) {
      const [range, step] = part.split("/");
      const stepNum = parseInt(step);

      let [start, end] = range === "*" ? [min, max] : range.split("-").map(Number);
      if (end === undefined) end = start;

      for (let i = start; i <= end; i += stepNum) {
        result.add(i);
      }
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) result.add(i);
    } else {
      result.add(parseInt(part));
    }
  });

  return result;
}

function shouldRunCron(cron, date) {
  const [minF, hourF, dayF, monthF, weekF] = cron.split(" ");

  const minute = date.getMinutes();
  const hour = date.getHours();
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const week = date.getDay();

  const fields = [
    [minF, minute, 0, 59],
    [hourF, hour, 0, 23],
    [dayF, day, 1, 31],
    [monthF, month, 1, 12],
    [weekF, week, 0, 6]
  ];

  for (const [field, value, min, max] of fields) {
    const parsed = parseField(field, min, max);
    if (parsed && !parsed.has(value)) return false;
  }

  return true;
}
