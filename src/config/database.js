const { Sequelize } = require('sequelize');

const common = {
  dialect: 'mysql',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: { max: Number(process.env.DB_POOL_MAX || 12), min: Number(process.env.DB_POOL_MIN || 0), acquire: Number(process.env.DB_POOL_ACQUIRE_MS || 30000), idle: Number(process.env.DB_POOL_IDLE_MS || 10000) },
  define: { underscored: true, timestamps: true }
};

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, common)
  : new Sequelize(
      process.env.MYSQLDATABASE || 'ankara_goat',
      process.env.MYSQLUSER || 'root',
      process.env.MYSQLPASSWORD || '',
      {
        ...common,
        host: process.env.MYSQLHOST || 'localhost',
        port: Number(process.env.MYSQLPORT || 3306)
      }
    );

module.exports = sequelize;
