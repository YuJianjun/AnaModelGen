* SerDes CTLE Testbench
* Source-degenerated differential pair with resistive load
.SUBCKT ctle_core vinp vinn voutp voutn vtail vdd vss
M1 voutp vinp tail vss nmos W=10u L=0.18u M=1
M2 voutn vinn tail vss nmos W=10u L=0.18u M=1
R1 voutp vdd 500
R2 voutn vdd 500
Rtail tail vtail 100
Ctail tail vss 1p
.ENDS ctle_core

* Top-level testbench
.SUBCKT serdes_phy dinp dinn doutp doutn clk rst_n
XCTLE dinp dinn netp netn vtail vdd vss ctle_core
Ibias vtail vss 1mA
Vdd vdd vss 1.2V
.ENDS serdes_phy
