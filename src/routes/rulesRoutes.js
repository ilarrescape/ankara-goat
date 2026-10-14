const express=require('express');
const {publicRulesConfig}=require('../services/tournamentRules');
const router=express.Router();
router.get('/',(req,res)=>res.json(publicRulesConfig()));
module.exports=router;
