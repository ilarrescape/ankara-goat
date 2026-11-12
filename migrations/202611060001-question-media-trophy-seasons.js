const {DataTypes}=require('sequelize');
module.exports={
  async up({context:qi}){
    await qi.addColumn('questions','question_media',{type:DataTypes.JSON,allowNull:true});
    await qi.addColumn('tournaments','trophy_image_url',{type:DataTypes.STRING(1000),allowNull:true});
    await qi.addColumn('tournaments','season_number',{type:DataTypes.INTEGER.UNSIGNED,allowNull:false,defaultValue:1});
  },
  async down({context:qi}){
    await qi.removeColumn('tournaments','season_number');
    await qi.removeColumn('tournaments','trophy_image_url');
    await qi.removeColumn('questions','question_media');
  }
};
