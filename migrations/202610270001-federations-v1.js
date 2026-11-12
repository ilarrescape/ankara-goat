const {DataTypes:D}=require('sequelize');

const id=()=>({type:D.INTEGER.UNSIGNED,primaryKey:true,autoIncrement:true});
const bigId=()=>({type:D.BIGINT.UNSIGNED,primaryKey:true,autoIncrement:true});
const ts=()=>({created_at:{type:D.DATE,allowNull:false},updated_at:{type:D.DATE,allowNull:false}});
const fk=(table,nullable=false)=>({type:D.INTEGER.UNSIGNED,allowNull:nullable,references:{model:table,key:'id'},onUpdate:'CASCADE',onDelete:nullable?'SET NULL':'CASCADE'});
const text=(n)=>({type:D.STRING(n),allowNull:false});

module.exports={
  async up({context:qi}){
    await qi.createTable('federations',{
      id:id(),president_id:fk('users'),name:text(100),slug:{...text(120),unique:true},
      description:{type:D.TEXT,allowNull:false},crest_url:{type:D.STRING(500)},banner_url:{type:D.STRING(500)},
      is_public:{type:D.BOOLEAN,allowNull:false,defaultValue:true},
      requires_approval:{type:D.BOOLEAN,allowNull:false,defaultValue:false},
      categories:{type:D.JSON,allowNull:false},invite_code:{...text(24),unique:true},
      manifesto:{type:D.TEXT,allowNull:false},manifesto_version:{type:D.INTEGER.UNSIGNED,allowNull:false,defaultValue:1},
      status:{type:D.ENUM('active','suspended','archived'),allowNull:false,defaultValue:'active'},
      last_activity_at:{type:D.DATE,allowNull:false},...ts()
    });
    await qi.addColumn('tournaments','federation_id',fk('federations',true));
    await qi.addColumn('tournaments','federation_category',{type:D.STRING(80),allowNull:true});
    await qi.addColumn('tournaments','federation_scope',{type:D.ENUM('federative','interfederative','classic'),allowNull:true});
    await qi.addColumn('questions','federation_id',fk('federations',true));
    await qi.addColumn('questions','federation_author_id',fk('users',true));
    await qi.addColumn('game_questions','question_snapshot',{type:D.JSON,allowNull:true});
    await qi.addIndex('questions',['federation_id','review_status','active','tier'],{name:'idx_fed_question_pool'});
    await qi.addIndex('tournaments',['federation_id','status'],{name:'idx_fed_tournaments'});
    await qi.createTable('federation_members',{
      id:id(),federation_id:fk('federations'),user_id:fk('users'),
      role:{type:D.ENUM('president','secretary','member'),allowNull:false,defaultValue:'member'},
      status:{type:D.ENUM('pending','active','rejected'),allowNull:false,defaultValue:'active'},
      permissions:{type:D.JSON,allowNull:false},joined_at:{type:D.DATE,allowNull:true},...ts()
    });
    await qi.addIndex('federation_members',['federation_id','user_id'],{name:'uq_fed_member',unique:true});
    await qi.createTable('federation_knowledges',{
      id:id(),federation_id:fk('federations'),tournament_id:fk('tournaments',true),author_id:fk('users'),
      title:text(180),url:{type:D.STRING(1000),allowNull:false},category:{type:D.STRING(80),allowNull:true},
      version:{type:D.INTEGER.UNSIGNED,allowNull:false,defaultValue:1},active:{type:D.BOOLEAN,allowNull:false,defaultValue:true},...ts()
    });
    await qi.addIndex('federation_knowledges',['federation_id','tournament_id'],{name:'idx_fed_knowledge'});
    await qi.createTable('federation_revisions',{
      id:bigId(),federation_id:fk('federations'),editor_id:fk('users'),
      kind:{type:D.ENUM('question','knowledge','manifesto'),allowNull:false},
      entity_id:{type:D.INTEGER.UNSIGNED,allowNull:false},version:{type:D.INTEGER.UNSIGNED,allowNull:false},
      snapshot:{type:D.JSON,allowNull:false},...ts()
    });
    await qi.addIndex('federation_revisions',['federation_id','kind','entity_id','version'],{name:'idx_fed_revisions'});
    await qi.createTable('federation_proposals',{
      id:id(),federation_id:fk('federations'),proposer_id:fk('users'),tournament_id:fk('tournaments',true),
      payload:{type:D.JSON,allowNull:false},status:{type:D.ENUM('pending','approved','rejected'),allowNull:false,defaultValue:'pending'},...ts()
    });
    await qi.createTable('federation_challenges',{
      id:id(),challenger_id:fk('federations'),challenged_id:fk('federations'),created_by_id:fk('users'),
      tournament_id:fk('tournaments',true),kind:{type:D.ENUM('interfederative','classic'),allowNull:false,defaultValue:'interfederative'},
      terms:{type:D.JSON,allowNull:false},status:{type:D.ENUM('pending','accepted','rejected','finished'),allowNull:false,defaultValue:'pending'},
      result:{type:D.JSON,allowNull:true},...ts()
    });
    await qi.createTable('federation_events',{
      id:bigId(),federation_id:fk('federations'),actor_id:fk('users',true),
      kind:text(40),message:text(500),payload:{type:D.JSON,allowNull:false},...ts()
    });
    await qi.addIndex('federation_events',['federation_id','created_at'],{name:'idx_fed_event_date'});
    await qi.createTable('federation_notifications',{
      id:bigId(),user_id:fk('users'),federation_id:fk('federations'),
      event_id:{type:D.BIGINT.UNSIGNED,allowNull:false,references:{model:'federation_events',key:'id'},onDelete:'CASCADE',onUpdate:'CASCADE'},
      read_at:{type:D.DATE,allowNull:true},...ts()
    });
    await qi.addIndex('federation_notifications',['user_id','read_at','created_at'],{name:'idx_fed_notice_inbox'});
    await qi.createTable('federation_attendances',{
      id:id(),federation_id:fk('federations'),match_id:fk('matches'),
      scheduled_at:{type:D.DATE,allowNull:false},invited_ids:{type:D.JSON,allowNull:false},
      present_ids:{type:D.JSON,allowNull:false},reprogram_count:{type:D.TINYINT.UNSIGNED,allowNull:false,defaultValue:0},
      resolution:{type:D.JSON,allowNull:true},...ts()
    });
    await qi.addIndex('federation_attendances',['match_id'],{name:'uq_fed_attendance_match',unique:true});
    await qi.createTable('federation_achievements',{
      id:bigId(),scope_key:{type:D.STRING(40),allowNull:false,defaultValue:'global'},
      federation_id:fk('federations',true),user_id:fk('users'),
      family:{type:D.ENUM('victories','correct_answers','streaks'),allowNull:false},code:text(60),
      value:{type:D.INTEGER.UNSIGNED,allowNull:false,defaultValue:0},awarded_at:{type:D.DATE,allowNull:false},...ts()
    });
    await qi.addIndex('federation_achievements',['scope_key','user_id','code'],{name:'uq_fed_achievement',unique:true});
  },
  async down({context:qi}){
    for(const table of ['federation_achievements','federation_attendances','federation_notifications',
      'federation_events','federation_challenges','federation_proposals','federation_revisions',
      'federation_knowledges','federation_members'])await qi.dropTable(table);
    await qi.removeIndex('questions','idx_fed_question_pool');
    await qi.removeIndex('tournaments','idx_fed_tournaments');
    await qi.removeColumn('questions','federation_author_id');
    await qi.removeColumn('game_questions','question_snapshot');
    await qi.removeColumn('questions','federation_id');
    await qi.removeColumn('tournaments','federation_scope');
    await qi.removeColumn('tournaments','federation_category');
    await qi.removeColumn('tournaments','federation_id');
    await qi.dropTable('federations');
  }
};
