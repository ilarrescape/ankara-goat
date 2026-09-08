const path = require('path');
const { Umzug, SequelizeStorage } = require('umzug');
const sequelize = require('./database');

function migrator() {
  return new Umzug({
    migrations: { glob: path.join(__dirname, '..', '..', 'migrations', '*.js') },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console
  });
}

async function runMigrations() {
  return migrator().up();
}

module.exports = { migrator, runMigrations };
