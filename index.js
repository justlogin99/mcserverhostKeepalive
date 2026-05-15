const mineflayer = require('mineflayer');
const http = require('http');

/**
 * ==========================================
 * 1. HTTP 心跳服务 (Render 保活)
 * ==========================================
 */
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('KeepAliveBot 系统状态：管理员模式已激活\n当前状态：持续保活中...');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ HTTP 唤醒接口已就绪，端口: ${PORT}`);
});

/**
 * ==========================================
 * 2. 机器人核心逻辑
 * ==========================================
 */
let bot;
let jumpInterval;
let clearItemInterval;

// 清理定时任务，防止重连时发生内存溢出和动作混乱
function stopTasks() {
    if (jumpInterval) clearInterval(jumpInterval);
    if (clearItemInterval) clearInterval(clearItemInterval);
}

function createBot() {
    console.log('--- 🛡️ 正在以管理员身份同步至 Minecraft 服务器 ---');
    
    bot = mineflayer.createBot({
        host: '163.5.201.2',
        port: 11087,
        username: 'russ', // 锁死白名单 ID
        version: '1.21.11',
        auth: 'offline',
        checkTimeoutInterval: 60 * 1000 // 提高网络容错
    });

    // --- 登录成功后的初始化 ---
    bot.on('spawn', () => {
        console.log('✅ KeepAliveBot 已上线！正在执行高权限初始化...');

        // 利用 OP 权限执行三位一体保活策略
        bot.chat('/gamemode creative');
        bot.chat('/tp 0 80 0');
        bot.chat('/difficulty peaceful');
        console.log('🛡️ 环境初始化完成：创造模式 + 安全坐标 + 和平模式');

        // 启动行为定时任务
        stopTasks(); // 确保启动前没有残留的定时器
        
        // 行为保活逻辑：每 4 分钟跳跃一次
        jumpInterval = setInterval(() => {
            if (bot && bot.entity) {
                bot.setControlState('jump', true);
                setTimeout(() => {
                    if (bot) bot.setControlState('jump', false);
                }, 500);
            }
        }, 4 * 60 * 1000);

        // 自动清理逻辑：每 1 小时清理一次掉落物
        clearItemInterval = setInterval(() => {
            if (bot) {
                bot.chat('/kill @e[type=item]');
                console.log('🧹 已自动清理全服地面掉落物');
            }
        }, 60 * 60 * 1000);
    });

    // --- 死亡处理 ---
    bot.on('death', () => {
        console.log('⚠️ 检测到角色异常死亡，正在执行复活协议...');
        setTimeout(() => {
            if (bot && bot.respawn) bot.respawn();
        }, 2000);
    });

    // --- 自动愈合重连模块 ---
    const reconnect = (reason) => {
        console.log(`⚠️ 连接断开 [原因: ${reason}]，30秒后尝试系统自愈...`);
        stopTasks(); // 断开时立即停止定时任务
        if (bot) {
            try { bot.quit(); } catch (e) {}
            bot = null;
        }
        // 延迟 30 秒重连，给服务器留出清理“假死”账号的时间
        setTimeout(createBot, 30000);
    };

    bot.on('kicked', (reason) => reconnect(`被踢出游戏: ${JSON.stringify(reason)}`));
    bot.on('end', () => reconnect('网络链路终止'));
    bot.on('error', (err) => reconnect(`网络错误: ${err.message}`));
}

/**
 * ==========================================
 * 3. 生命周期管理与防顶号机制 (Render 专供)
 * ==========================================
 */

// 启动缓冲：容器启动后，延迟 10 秒再登录，避开旧容器还没死透的重叠期
console.log('⏳ 容器已启动，等待 10 秒后连接服务器以防顶号...');
setTimeout(createBot, 10000);

// 优雅停机：拦截 Render 的关闭信号，主动让机器人下线
const gracefulShutdown = (signal) => {
    console.log(`\n🛑 接收到系统关闭信号 [${signal}]，正在执行安全下线程序...`);
    stopTasks();
    if (bot) {
        try {
            bot.quit();
            console.log('✅ 机器人已安全断开连接');
        } catch (e) {
            console.log('⚠️ 机器人断开发生错误:', e.message);
        }
    }
    process.exit(0);
};

// 监听云平台的进程终止信号
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Render 的部署/休眠信号
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // 本地强制停止信号
