import {
  categoryMetadata,
  categoryPage,
  categoryStaticParams,
} from "../../_lib/category-route";

// FR-108: /categories/industries/[slug].

export const generateStaticParams = categoryStaticParams("industries");
export const generateMetadata = categoryMetadata("industries");
export default categoryPage("industries");
