const mineflayer = require('mineflayer');
const http = require('http');

/**
 * ==========================================
 * 1. HTTP 服务
 * ==========================================
 */

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end(
        'KeepAliveBot 系统状态：管理员模式已激活\n' +
        '当前状态：持续保活中...'
    );
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`✅ HTTP 服务已启动，端口: ${PORT}`);
});


/**
 * ==========================================
 * 2. 多账号配置
 * ==========================================
 *
 * 每个账号可以连接不同的 Minecraft 服务器。
 */

const accounts = [
    {
        name: 'russ',
        host: '144.31.46.17',
        port: 11691,
        username: 'russ'
    },

    {
        name: 'rose',
        host: '163.5.201.10',
        port: 11218,
        username: 'rose'
    }
];


/**
 * ==========================================
 * 3. Bot 管理器
 * ==========================================
 */

const bots = new Map();


class MinecraftBot {

    constructor(config) {
        this.name = config.name;
        this.host = config.host;
        this.port = config.port;
        this.username = config.username;

        this.bot = null;

        this.jumpInterval = null;
        this.clearItemInterval = null;
        this.spawnTimeout = null;
        this.reconnectTimeout = null;

        this.isReconnecting = false;
        this.isShuttingDown = false;
    }


    /**
     * 清理所有定时任务
     */
    stopTasks() {

        if (this.jumpInterval) {
            clearInterval(this.jumpInterval);
            this.jumpInterval = null;
        }

        if (this.clearItemInterval) {
            clearInterval(this.clearItemInterval);
            this.clearItemInterval = null;
        }

        if (this.spawnTimeout) {
            clearTimeout(this.spawnTimeout);
            this.spawnTimeout = null;
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
    }


    /**
     * 创建 Bot
     */
    create() {

        if (this.isShuttingDown) {
            return;
        }

        console.log('');
        console.log('==========================================');
        console.log(`🛡️ 正在启动账号: ${this.username}`);
        console.log(`🌐 服务器: ${this.host}:${this.port}`);
        console.log('==========================================');

        try {

            this.bot = mineflayer.createBot({

                host: this.host,
                port: this.port,

                username: this.username,

                version: '1.21.11',

                auth: 'offline',

                checkTimeoutInterval: 60 * 1000

            });

        } catch (err) {

            console.log(
                `❌ [${this.username}] 创建 Bot 失败:`,
                err.message
            );

            this.scheduleReconnect('创建 Bot 失败');

            return;
        }


        /**
         * ==========================================
         * Bot 上线
         * ==========================================
         */

        this.bot.on('spawn', () => {

            console.log(
                `✅ [${this.username}] 已成功进入 Minecraft！`
            );

            this.isReconnecting = false;


            /**
             * 延迟 3 秒执行初始化指令
             */

            this.spawnTimeout = setTimeout(() => {

                if (!this.bot || !this.bot.entity) {
                    return;
                }

                try {

                    this.bot.chat('/gamemode creative');

                    this.bot.chat('/tp 0 80 0');

                    this.bot.chat('/difficulty peaceful');

                    console.log(
                        `🛡️ [${this.username}] 环境初始化完成`
                    );

                } catch (err) {

                    console.log(
                        `⚠️ [${this.username}] 初始化指令失败:`,
                        err.message
                    );
                }

            }, 3000);


            /**
             * ==========================================
             * 每 4 分钟跳跃一次
             * ==========================================
             */

            this.jumpInterval = setInterval(() => {

                if (
                    this.bot &&
                    this.bot.entity &&
                    !this.isReconnecting
                ) {

                    try {

                        this.bot.setControlState('jump', true);

                        setTimeout(() => {

                            if (this.bot) {
                                this.bot.setControlState('jump', false);
                            }

                        }, 500);

                        console.log(
                            `🚶 [${this.username}] 执行防休眠动作：跳跃`
                        );

                    } catch (err) {

                        console.log(
                            `⚠️ [${this.username}] 跳跃失败:`,
                            err.message
                        );
                    }
                }

            }, 4 * 60 * 1000);


            /**
             * ==========================================
             * 每小时清理掉落物
             * ==========================================
             */

            this.clearItemInterval = setInterval(() => {

                if (
                    this.bot &&
                    this.bot.entity &&
                    !this.isReconnecting
                ) {

                    try {

                        this.bot.chat('/kill @e[type=item]');

                        console.log(
                            `🧹 [${this.username}] 已执行掉落物清理`
                        );

                    } catch (err) {

                        console.log(
                            `⚠️ [${this.username}] 清理掉落物失败:`,
                            err.message
                        );
                    }
                }

            }, 60 * 60 * 1000);

        });


        /**
         * ==========================================
         * 死亡自动复活
         * ==========================================
         */

        this.bot.on('death', () => {

            console.log(
                `💀 [${this.username}] 角色死亡，2 秒后尝试复活`
            );

            setTimeout(() => {

                if (this.bot && this.bot.respawn) {

                    try {
                        this.bot.respawn();
                    } catch (err) {

                        console.log(
                            `⚠️ [${this.username}] 复活失败:`,
                            err.message
                        );
                    }
                }

            }, 2000);

        });


        /**
         * ==========================================
         * 被踢
         * ==========================================
         */

        this.bot.on('kicked', (reason) => {

            this.reconnect(
                `被服务器踢出: ${JSON.stringify(reason)}`
            );

        });


        /**
         * ==========================================
         * 网络连接结束
         * ==========================================
         */

        this.bot.on('end', () => {

            this.reconnect('网络连接终止');

        });


        /**
         * ==========================================
         * 网络错误
         * ==========================================
         */

        this.bot.on('error', (err) => {

            this.reconnect(
                `网络错误: ${err.message}`
            );

        });

    }


    /**
     * ==========================================
     * 重连
     * ==========================================
     */

    reconnect(reason) {

        if (this.isReconnecting || this.isShuttingDown) {
            return;
        }

        this.isReconnecting = true;

        console.log('');
        console.log(
            `⚠️ [${this.username}] 连接断开`
        );

        console.log(
            `原因: ${reason}`
        );


        this.stopTasks();


        if (this.bot) {

            try {
                this.bot.removeAllListeners();
                this.bot.quit();
            } catch (e) {}

            this.bot = null;
        }


        console.log(
            `⏳ [${this.username}] 60 秒后自动重连...`
        );


        this.reconnectTimeout = setTimeout(() => {

            if (this.isShuttingDown) {
                return;
            }

            this.isReconnecting = false;

            this.create();

        }, 60 * 1000);

    }


    /**
     * 安排重连
     */

    scheduleReconnect(reason) {

        if (this.isReconnecting || this.isShuttingDown) {
            return;
        }

        this.isReconnecting = true;

        console.log(
            `⏳ [${this.username}] 60 秒后重新连接...`
        );

        this.reconnectTimeout = setTimeout(() => {

            this.isReconnecting = false;

            this.create();

        }, 60 * 1000);

    }


    /**
     * 安全关闭
     */

    shutdown() {

        this.isShuttingDown = true;

        this.stopTasks();

        if (this.bot) {

            try {

                this.bot.quit();

                console.log(
                    `✅ [${this.username}] 已安全退出`
                );

            } catch (err) {

                console.log(
                    `⚠️ [${this.username}] 退出时发生错误:`,
                    err.message
                );
            }

            this.bot = null;
        }
    }
}


/**
 * ==========================================
 * 4. 启动所有账号
 * ==========================================
 *
 * 不让所有账号同时登录。
 * 每个账号间隔 10 秒。
 */

accounts.forEach((config, index) => {

    const bot = new MinecraftBot(config);

    bots.set(config.name, bot);

    const delay = 30 * 1000 + index * 10 * 1000;

    console.log(
        `⏳ [${config.username}] 将在 ${delay / 1000} 秒后启动`
    );

    setTimeout(() => {

        bot.create();

    }, delay);

});


/**
 * ==========================================
 * 5. Render / 系统关闭处理
 * ==========================================
 */

const gracefulShutdown = (signal) => {

    console.log('');
    console.log(
        `🛑 接收到系统关闭信号: ${signal}`
    );

    console.log(
        '正在安全关闭所有 Minecraft Bot...'
    );


    for (const bot of bots.values()) {
        bot.shutdown();
    }


    server.close(() => {

        console.log('✅ HTTP 服务已关闭');

        process.exit(0);

    });


    setTimeout(() => {
        process.exit(0);
    }, 5000);
};


process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
    gracefulShutdown('SIGINT');
});
