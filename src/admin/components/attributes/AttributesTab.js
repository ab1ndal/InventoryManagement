import React from "react";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "../../../components/ui/tabs";
import ColorsManager from "./ColorsManager";
import FabricsManager from "./FabricsManager";
import SizesManager from "./SizesManager";

// Nested Colors/Fabrics/Sizes managers, rendered inside the Admin hub's
// superadmin-only "Attributes" subtab.
export default function AttributesTab() {
  return (
    <Tabs defaultValue="colors">
      <TabsList>
        <TabsTrigger value="colors">Colors</TabsTrigger>
        <TabsTrigger value="fabrics">Fabrics</TabsTrigger>
        <TabsTrigger value="sizes">Sizes</TabsTrigger>
      </TabsList>
      <TabsContent value="colors"><ColorsManager /></TabsContent>
      <TabsContent value="fabrics"><FabricsManager /></TabsContent>
      <TabsContent value="sizes"><SizesManager /></TabsContent>
    </Tabs>
  );
}
