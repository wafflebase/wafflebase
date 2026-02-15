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

REFERENCE: REF | REFRANGE ;
REF: [A-Za-z]{1,3}[1-9][0-9]* ;
REFRANGE: REF ':' REF ;

BOOL: 'TRUE' | 'FALSE' | 'true' | 'false';
STRING: '"' (~["])* '"' ;
NUM: [0-9]+('.' [0-9]+)? ;
FUNCNAME: [A-Za-z][A-Za-z0-9]* ;
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
