const {DataTypes}=require('sequelize');
module.exports={
  async up({context:qi}){
    await qi.addColumn('questions','deleted_at',{type:DataTypes.DATE,allowNull:true});
    await qi.addIndex('questions',['federation_id','deleted_at'],{name:'idx_fed_question_deleted'});
  },
  async down({context:qi}){
    await qi.removeIndex('questions','idx_fed_question_deleted');
    await qi.removeColumn('questions','deleted_at');
  }
};
