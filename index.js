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
let spawnTimeout;

// 清理定时任务，防止重连时发生内存溢出和动作混乱
function stopTasks() {
    if (jumpInterval) clearInterval(jumpInterval);
    if (clearItemInterval) clearInterval(clearItemInterval);
    if (spawnTimeout) clearTimeout(spawnTimeout);
}

function createBot() {
    console.log('--- 🛡️ 正在以管理员身份同步至 Minecraft 服务器 ---');
    
    bot = mineflayer.createBot({
        host: '163.5.201.4',
        port: 11839,
        username: 'russ', // 锁死白名单 ID
        version: '1.21.11',
        auth: 'offline',
        checkTimeoutInterval: 60 * 1000 // 提高网络容错
    });

    bot.on('spawn', () => {
        console.log('✅ KeepAliveBot 已上线！正在执行高权限初始化...');
        isReconnecting = false; // 成功上线后，解锁重连状态

        // 延迟 3 秒执行指令，防止刚进服时区块未加载导致坠落虚空
        spawnTimeout = setTimeout(() => {
            if (!bot) return;
            bot.chat('/gamemode creative');
            bot.chat('/tp 0 80 0');
            bot.chat('/difficulty peaceful');
            console.log('🛡️ 环境初始化完成：创造模式 + 安全坐标 + 和平模式');
        }, 3000);

        stopTasks(); 
        
        // 行为保活逻辑：每 4 分钟跳跃一次（完美契合 7 分钟休眠限制）
        jumpInterval = setInterval(() => {
            if (bot && bot.entity) {
                bot.setControlState('jump', true);
                setTimeout(() => {
                    if (bot) bot.setControlState('jump', false);
                }, 500);
                console.log('🚶 执行防休眠动作：跳跃');
            }
        }, 4 * 60 * 1000);

        clearItemInterval = setInterval(() => {
            if (bot) {
                bot.chat('/kill @e[type=item]');
                console.log('🧹 已自动清理全服地面掉落物');
            }
        }, 60 * 60 * 1000);
    });

    bot.on('death', () => {
        console.log('⚠️ 检测到角色异常死亡，正在执行复活协议...');
        setTimeout(() => {
            if (bot && bot.respawn) bot.respawn();
        }, 2000);
    });

    // --- 带有防抖锁的自动重连模块 ---
    let isReconnecting = false; 

    const reconnect = (reason) => {
        if (isReconnecting) return; // 如果已经在重连中了，就拦截多余的报错请求
        isReconnecting = true;

        console.log(`⚠️ 连接断开 [原因: ${reason}]`);
        stopTasks(); 
        
        if (bot) {
            try { bot.quit(); } catch (e) {}
            bot = null;
        }

        // 【关键修改】：将冷却时间拉长到 60 秒。
        // 服务器需要 7 分钟才关机，离开 1 分钟绝对安全，且能彻底洗掉假死残留的 UUID。
        console.log('⏳ 60秒后尝试系统自愈...');
        setTimeout(() => {
            isReconnecting = false; // 准备开始新一轮重连前解锁
            createBot();
        }, 60000); 
    };

    bot.on('kicked', (reason) => reconnect(`被踢出游戏: ${JSON.stringify(reason)}`));
    bot.on('end', () => reconnect('网络链路终止'));
    bot.on('error', (err) => reconnect(`网络错误: ${err.message}`));
}

/**
 * ==========================================
 * 3. 生命周期管理 (Render 专供)
 * ==========================================
 */

// 【关键修改】：启动缓冲拉长到 30 秒，彻底避开云端部署时新老代码交替的碰撞期
console.log('⏳ 容器已启动，等待 30 秒后连接服务器以防顶号...');
setTimeout(createBot, 30000);

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

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
