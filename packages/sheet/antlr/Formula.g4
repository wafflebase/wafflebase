grammar Formula;
formula: expr+ ;

expr: FUNCNAME '(' args? ')'         # Function
    | expr op=(MUL|DIV) expr         # MulDiv
    | expr op=(ADD|SUB) expr         # AddSub
    | expr op=(EQ|NEQ|LT|GT|LTE|GTE) expr  # Comparison
    | NUM                            # Number
    | BOOL                           # Boolean
    | STRING                         # Str
    | REFERENCE                      # Reference
    | '(' expr ')'                   # Parentheses
    ;

args: expr (',' expr)* ;

REFERENCE: QUOTED_SHEET_NAME '!' REFRANGE
         | QUOTED_SHEET_NAME '!' REF
         | SHEET_NAME '!' REFRANGE
         | SHEET_NAME '!' REF
         | REFRANGE
         | REF
         ;
fragment SHEET_NAME: [A-Za-z][A-Za-z0-9]* ;
fragment QUOTED_SHEET_NAME: '\'' (~['])+ '\'' ;
REF: '$'? [A-Za-z] [A-Za-z]? [A-Za-z]? '$'? [1-9][0-9]* ;
REFRANGE: REF ':' REF ;

BOOL: 'TRUE' | 'FALSE' | 'true' | 'false';
STRING: '"' (~["])* '"' ;
NUM: [0-9]+('.' [0-9]+)? ;
FUNCNAME: [A-Za-z][A-Za-z0-9_.]* ;
WS : [ \t]+ -> skip ;

MUL: '*' ;
DIV: '/' ;
ADD: '+' ;
SUB: '-' ;
EQ: '=' ;
NEQ: '<>' ;
LTE: '<=' ;
GTE: '>=' ;
LT: '<' ;
GT: '>' ;
