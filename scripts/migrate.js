require('dotenv').config();
const { sequelize } = require('../src/models');
const { runMigrations } = require('../src/config/migrations');

(async () => {
  try {
    await sequelize.authenticate();
    const done = await runMigrations();
    console.log(`Migraciones aplicadas: ${done.length}`);
    await sequelize.close();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
