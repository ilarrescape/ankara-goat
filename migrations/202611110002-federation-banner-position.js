// Guarda únicamente el encuadre del banner de cada Federación.
// Los banners existentes se mantienen centrados (50%, 50%).
const {DataTypes:D}=require('sequelize');
module.exports={
  async up({context:qi}){
    await qi.addColumn('federations','banner_position_x',{type:D.DECIMAL(5,1),allowNull:false,defaultValue:50});
    await qi.addColumn('federations','banner_position_y',{type:D.DECIMAL(5,1),allowNull:false,defaultValue:50});
  },
  async down({context:qi}){
    await qi.removeColumn('federations','banner_position_y');
    await qi.removeColumn('federations','banner_position_x');
  }
};
