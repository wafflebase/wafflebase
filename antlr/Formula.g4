grammar Formula;

formula: expr+ ;

expr: FUNCNAME '(' args? ')'         # Function
    | expr op=('*'|'/') expr         # MulDiv
    | expr op=('+'|'-') expr         # AddSub
    | NUM                            # Number
    | REFERENCE                      # Reference
    | '(' expr ')'                   # Parentheses
    ;

args: expr (',' expr)* ;


NUM : [0-9]+('.' [0-9]+)? ;
REFERENCE: [A-Za-z]{1,3}[1-9][0-9]* ;
FUNCNAME: [A-z]+ ;
WS  : [ \t]+ -> skip ;


MUL : '*' ;
DIV : '/' ;
ADD : '+' ;
SUB : '-' ;
