import { DigitalCommandBoard } from "../components/DigitalCommandBoard";
import { PageHeader } from "../components/ui";
import { useTenant } from "../lib/tenant";

export function KitchenPage() {
  const { branch } = useTenant();

  return (
    <div className="page-stack kitchen-page">
      <PageHeader
        title="Comandas digitales"
        description="Prioriza, prepara e imprime las comandas activas de la sucursal."
      />
      <DigitalCommandBoard branchId={branch?.id} />
    </div>
  );
}
