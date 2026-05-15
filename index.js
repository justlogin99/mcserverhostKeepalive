const mineflayer = require('mineflayer');
const http = require('http');

/**
 * 1. HTTP 心跳服务
 * 逻辑：由 UptimeRobot 每 5 分钟访问一次，防止 Render 容器进入 15 分钟休眠期。
 */
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('KeepAliveBot 系统状态：管理员模式已激活\n当前状态：持续保活中...');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ HTTP 唤醒接口已就绪，端口: ${PORT}`);
});

let bot;

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

    // --- 核心管理逻辑 ---

    bot.on('spawn', () => {
        console.log('✅ KeepAliveBot 已上线！正在执行高权限初始化...');

        // 利用 OP 权限执行三位一体保活策略
        // 1. 切换创造模式 (免疫所有伤害)
        bot.chat('/gamemode creative');
        
        // 2. 传送到绝对安全点 (主城高空或预设点)
        bot.chat('/tp 0 80 0');
        
        // 3. 将服务器设为和平模式 (根除怪物骚扰)
        bot.chat('/difficulty peaceful');

        console.log('🛡️ 环境初始化完成：创造模式 + 安全坐标 + 和平模式');
    });

    /**
     * 行为保活逻辑
     * 逻辑：每 4 分钟执行一次微小动作，彻底规避任何高级挂机检测插件。
     */
    setInterval(() => {
        if (bot && bot.entity) {
            // 向上跳跃一次
            bot.setControlState('jump', true);
            setTimeout(() => {
                if (bot) bot.setControlState('jump', false);
            }, 500);
        }
    }, 4 * 60 * 1000);

    /**
     * 自动清理逻辑 (可选)
     * 逻辑：每 1 小时清理一次掉落物，防止服务器因为掉落实体过多导致卡顿或崩溃。
     */
    setInterval(() => {
        if (bot) {
            bot.chat('/kill @e[type=item]');
            console.log('🧹 已自动清理全服地面掉落物');
        }
    }, 60 * 60 * 1000);

    // 死亡处理：预防极端意外 (如掉落虚空)
    bot.on('death', () => {
        console.log('⚠️ 检测到角色异常死亡，正在执行复活协议...');
        setTimeout(() => {
            if (bot && bot.respawn) bot.respawn();
        }, 2000);
    });

    // --- 自动愈合重连模块 ---

    const reconnect = (reason) => {
        console.log(`⚠️ 连接断开 [原因: ${reason}]，15秒后尝试系统自愈...`);
        if (bot) {
            try { bot.quit(); } catch (e) {}
        }
        setTimeout(createBot, 15000);
    };

    bot.on('kicked', (reason) => reconnect(`被踢出游戏: ${JSON.stringify(reason)}`));
    bot.on('end', () => reconnect('网络链路终止'));
    bot.on('error', (err) => reconnect(`网络错误: ${err.message}`));
}

// 启动主程序
createBot();
